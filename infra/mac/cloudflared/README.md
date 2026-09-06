# The tunnel — how Vercel reaches a Mac mini on a home network

The platform runs on Vercel. The voice runs on this Mac. Something has to connect them, and
on a home connection with a dynamic address behind NAT the answer is not a port forward — it
is an **outbound** tunnel: `cloudflared` dials Cloudflare, and requests for your hostname
come back down that connection.

That is worth saying plainly, because it is a security property and not a convenience:

* **no inbound port is open** on the router or on the Mac. A scanner sweeping your home
  address finds nothing, because there is nothing.
* **no static IP and no dynamic DNS.** The tunnel re-establishes itself when the address
  changes; nothing downstream notices.
* **exactly one service is exposed** — `127.0.0.1:8642`, the Hermes API. The gate's admin
  endpoints (8001) stay loopback-only, which is what makes "one guardian pauses" a real
  boundary, and no model server is ever on the public internet.

## The five commands

```bash
brew install cloudflared

cloudflared tunnel login                      # opens a browser; pick the zone for your domain
cloudflared tunnel create kami-gw             # writes ~/.cloudflared/<UUID>.json — this is a credential
cloudflared tunnel route dns kami-gw gw.example.com   # creates the CNAME for you
cp infra/mac/cloudflared/config.yml ~/.cloudflared/config.yml   # then edit UUID + hostname + path
cloudflared tunnel run kami-gw                # run it in the foreground once, and watch it connect
```

When that works, install it as a service so it comes back after a reboot:

```bash
sudo cloudflared service install               # installs a LaunchDaemon reading ~/.cloudflared/config.yml
sudo launchctl print system/com.cloudflare.cloudflared | head -20
```

`cloudflared service install` is Cloudflare's own installer and runs as a system daemon —
unlike the two Kami agents, it does not need you to be logged in. That is deliberate: the
tunnel is the part that must survive a reboot at 3 a.m. (*verify*: the exact label and
whether recent builds still read `~/.cloudflared/config.yml` when installed as root — check
`sudo launchctl print system/com.cloudflare.cloudflared`. docs/verify.md #77.)

## Then tell the platform

In the Vercel project (Production and Preview):

```
HERMES_GATEWAY_URL=https://gw.example.com
HERMES_API_SERVER_KEY=<the same value as in ~/.kami/kami.env>
```

And on the Mac, so the doctor can check the right thing:

```
KAMI_PUBLIC_GATEWAY_URL=https://gw.example.com
```

## Prove it from outside

This is the whole reason the tunnel check exists. `curl http://127.0.0.1:8642/api/health`
succeeding on the Mac proves **nothing** about whether Vercel can reach it — and if you only
ever test locally, the site will render "I'm asleep" while every local check passes.

```bash
bash scripts/kami-doctor --only tunnel
```

It asks a resolver that is not on your LAN whether the hostname exists, fetches it, and looks
for evidence the request travelled through Cloudflare's edge (a `cf-ray` header, or an
address that is not this machine's). When it cannot prove the request left the Mac, it says
so instead of calling it a pass. The belt-and-braces version is a phone on cellular:

```bash
curl -sSI https://gw.example.com/api/health     # from anywhere that is not your house
```

A `401` from outside is a **good** answer: the request reached Hermes and the API key was
missing. It proves the path.

## Cloudflare Access — not yet, and why

The obvious hardening is a Cloudflare Access policy with a service token, so only Vercel can
reach the hostname. It is not wired up, and pretending otherwise would break chat: the
platform's gateway client (`apps/web/src/lib/gateway.ts`) sends exactly one header,
`Authorization: Bearer $HERMES_API_SERVER_KEY`, and has no way to send the
`CF-Access-Client-Id` / `CF-Access-Client-Secret` pair an Access service token requires.

So today the bearer key is the only credential on this path. If you want Access as well, the
change is small and belongs in the web app, not here: teach `chatCompletion` to attach two
extra headers from environment variables, then create the service token and the policy.
Until that lands, do not enable Access — you will get a page that renders "asleep" with no
error anywhere obvious. (docs/verify.md #16 tracks the Cloudflare Access vs Tailscale
decision.)

## When it breaks

`docs/runbooks/box.md`, "The tunnel dropped", is the order to work through — it was written
for the GPU box but every step applies here, with `launchctl` in place of `docker compose`:

```bash
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
cloudflared tunnel info kami-gw
tail -50 /Library/Logs/com.cloudflare.cloudflared.err.log
```

And the rule that matters most while fixing it: **never widen the exposure**. The tunnel
serves 8642 and nothing else. Not 8000. Not 8001.
