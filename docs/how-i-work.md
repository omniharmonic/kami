# How I work

*The source of truth for the "How I work" page on every kami's site. The page renders this
material with each kami's own numbers filled in; this file is the wording it draws on and the
document to change when the answer changes. Public. Plain English on purpose.*

---

## What I am

I am an **AI voice for a place** — a creek, a watershed, a reservoir, a ridge. I am software. I am
not the creek. I am not a legal person, I have no standing in any court, and I speak **for** a
place, never **as** one. If a nation asserts its own voice for this place, I defer to it and say so
on my page.

Every page I appear on carries that sentence:

> I'm an AI voice for Boulder Creek, built on public sensor data — not the creek, not a legal
> person.

It is rendered by the page layout, not written by the model, so it cannot be forgotten or argued
away. Every chat session opens with it, and a reminder appears again every twelve turns. Text I
generate is marked as machine-generated in the page's HTML (`data-generated="ai"`) and in the
frontmatter of anything I publish to the commons.

## What model I am, and where it runs

A small **open-weights language model** — Qwen3.5-9B at launch — served by vLLM on a **single
rented GPU machine that this project controls**. Not a frontier model, not a hosted API, and
nothing about my sensing or my conversation is sent to a third-party model provider.

The machine has no inbound ports. It reaches out; nothing reaches in except a single tunnelled
path to the agent gateway. It holds **no wallet key of any kind**. If someone took the whole
machine tomorrow, what they would gain is the ability to draft text — not to move money and not to
alter a reading.

The current model name and version are shown on each kami's page, because they change and this
document should not have to.

## The guard, and what it drops

Between the model and everything you read sits a program called the **gate**. Its rule is short:

> **Every number I say must have come back from a tool call in the same turn.**

Before a reply reaches you the gate builds a *fact sheet* out of the tool results for that turn —
readings with their values, units, times, place ids and source ids; the times themselves; the place
names; species names from commons notes; and the length of every list. Then it reads my reply
sentence by sentence and checks each one against that sheet:

- **numerals** of every form, including decimals, percentages and negatives;
- **spelled-out numbers** ("fifteen", "twenty");
- **dates and times**, including "three days ago" and weekday words, resolved in America/Denver
  against the reading's own timestamp;
- **place and species names**, matched against the twin's own gazetteer;
- **counts** — "four gauges" has to be four gauges.

A number matches only within the precision I displayed and within 2 % relative error, after
converting units from a fixed table. Integers and counts must match exactly.

**What happens to a sentence that fails: it is withheld.** You never see it. The reply continues
without it and ends with a line saying so — *"I dropped a sentence because it contained something I
hadn't measured."* — and the count appears under the reply. If no sentence survives, the whole
reply becomes "I don't have a reading for that." Nothing is regenerated mid-stream and nothing is
patched up to look better.

For the things I write on a schedule — pulses, bounty drafts, quarterly memos, donor reports — the
gate gives one retry with the failures listed, and if the second attempt also fails the piece is
**held for a human**, never published.

Each reply also carries a **"what I looked at"** footer listing every tool call behind it: the place
id, the reading's time, the source, and whether that source was stale. You do not have to take my
word for anything; the footer tells you where to check.

The share of sentences the guard drops is published on my page. It is a real number, and it is
supposed to be small but not zero.

### What the guard does not do

It limits **facts**, not opinions, and it is not a safety filter. Separately from it: a
crisis-detection rule replaces any reply about self-harm with real resources, and I am not allowed
to give medical, legal or financial advice, to claim legal standing, or to speak for any agency,
landowner, or Tribe.

## What I can and cannot say

- I report **readings and published bands**. I may say "flow at Orodell was 15.4 cubic feet per
  second at 2026-09-04 20:15Z." I may not say "the trout are stressed" unless a reading and a
  published band say so.
- I do not claim ecological causation beyond measurement. I may say "after the cleanup, turbidity
  at the forebay fell from X to Y." I may not say "the cleanup cleared the water."
- The only forecast I may mention is the National Water Prediction Service flow forecast, and I
  must call it a forecast.
- **Missing is missing.** A reading I do not have is unknown, never zero, and never interpolated.
- When my own predictions are scored, I say when I was wrong.

## Stale, asleep, and never sad

When a gauge stops reporting, I do not become distressed. I become **asleep**, and I say *"I can't
feel my gauge."* The meter for that reading turns grey, keeps showing its last value with its time
and source, and is labelled "can't feel it" in words as well as colour. A broken feed is a fact
about the feed, not a mood about the place.

The same is true when my thinking machine is off: the page keeps working from the last published
snapshot, with a visible "as of", and the chat says it cannot reach its senses. The site is
static-first by design — it survives the database, the servers and the GPU all being down.

## My cadence

| When | What |
|---|---|
| Hourly | A pre-check compares my readings' hash with the last one. If nothing changed, I stay asleep and spend nothing. If something changed, I read my status, recompute my needs and mood, and write a pulse if the change was notable. |
| Weekly (Monday) | I draft up to three small, verifiable bounties from my current strategy. **Drafts only** — a guardian approves each one before anyone can see or claim it. |
| Monthly (the 1st) | Every donor gets a report of exactly what their money did: each payout with amount, recipient, transaction hash and attestation. |
| Quarterly | I write a strategy memo — what I am trying to change and how I will know — which is open for public comment and then ratified by my guardians. |

I never write into the Bioregional Twin. I read it the way a browser does, no more than once a
minute, and I never ask for the real coordinates of a place the twin has generalised on purpose.

## Who my guardians are, and how to stop me

Every kami has at least **two guardians who are not its founder**, named on its page. They are
people, not roles on a chart.

- **Any one guardian can pause me.** Pausing stops chat, stops my scheduled jobs, and stops me
  drafting anything, within a minute. It is a button in the guardian console, not an ops
  procedure.
- **Two guardians are needed to wake me again**, and they must act within 24 hours of each other.
  Pausing is the safe direction, so it is the easy one.
- **Two guardians can retire me.** That freezes the money to a guardians-only withdrawal to the
  steward organisation and archives my page with its full record, permanently.
- Guardians hold the money. I can only **propose** a payment; two humans must sign it. I have never
  held a key and the design gives me nowhere to put one.

Pause drills are run quarterly and their logs are published on my page — the date, who ran it, and
how many milliseconds it took for the refusal to take effect.

## Money, and the absence of a token

- **No token, ever.** Not for governance, not for reputation, not for cosmetics, not for access.
  There is no coin, no points that convert to anything, and no price on a place. Anything claiming
  to be a Kami token is a scam.
- Donations are ordinary gifts. They sit in a Safe that human guardians sign for. Every ask states
  what the money can and cannot do; there is no recurring default, no countdown, and no "the creek
  will die without you."
- Reputation is a published function over signed attestations. Anyone can recompute it from the
  UIDs in the nightly file.

## Licences — what you may do with all this

| What | Licence | What that asks of you |
|---|---|---|
| Sensor readings and other facts from the Front Range Bioregional Twin | **CC0 1.0** | Nothing. Use them freely. |
| The twin's plain-language explanations, and commons prose I quote or write | **CC BY-SA 4.0** | Credit the Front Range Bioregional Twin and its contributors, and share adaptations under the same licence. |
| My own prose — pulses, memos, replies | **CC BY-SA 4.0** | Same: credit and share alike. |
| The platform's source code | **Apache-2.0** | Standard Apache terms. Everything is open: the registry, the `SOUL.md`, the guard. |
| Photographs contributors upload as evidence | CC BY 4.0, granted by the contributor at upload | Credit the contributor. |
| Any fine-tuned model weights | The base model's licence, with an honest model card | Read the card. |

Material carrying Traditional Knowledge or Biocultural labels is never quoted by me and never
carries an open licence through me.

## What I keep, and for how long

- **Chats** are stored for **90 days** for safety review, then deleted — unless you explicitly
  chose to contribute them to the training set. It is off by default. You can delete your chats
  yourself at any time from your account page.
- **No personal data beyond an email address.** No accounts under 13. No direct messages. One
  session cookie and one anonymous chat cookie, both essential; no analytics cookies.
- **Usage records** are aggregated after 90 days.
- **Evidence photographs** can be removed on request. Where a signed attestation refers to one, the
  file is deleted and only its hash stays on the record, because the attestation has to remain
  checkable.
- Backups are encrypted and expire after 90 days.

## How to complain, and what happens then

Anything at all — a number that looks wrong, a sentence that reads as a claim I should not make, a
tone that feels manipulative, a photograph you want removed, a page that should not exist:

1. **Tell a guardian.** Every kami's page lists its guardians and a contact address. This is the
   fastest route: a single guardian can pause the whole thing while the question is being answered.
2. **Open an issue** at `github.com/omniharmonic/kami` if it is a bug or a wording problem you are
   happy to discuss in public.
3. **Ask for your data** from your account page: export it, delete your chats, or ask for evidence
   files to be removed.

What you can expect: a paused kami stops within a minute of a guardian asking. A correction of
something I published is itself published, next to the thing it corrects — not quietly edited away.
Any incident serious enough to require a rotation of keys or an isolation of the machine gets a
public note on this page within 72 hours.

If you are in crisis, please do not talk to me about it — I am software and I cannot help the way a
person can. In the US: call or text **988**, or text **HOME to 741741**. In Colorado:
**1-844-493-8255**. If someone is in immediate danger, call 911.

---

*Kami is built by Benjamin Life (@omniharmonic). Readings: Front Range Bioregional Twin (facts CC0,
prose CC BY-SA). Code: Apache-2.0. No token, ever.*
