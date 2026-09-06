# `docs/deploy` — putting the first entity into the world

Three documents, in the order you need them:

| file | what it is for |
|---|---|
| [`first-entity.md`](first-entity.md) | **the spine.** From nothing to a talking creek in four checkpoints, each ending in a `kami doctor` run that must pass before you move on. |
| [`vercel.md`](vercel.md) | the hosted half: the Vercel project, Neon and its migrations, the R2 bucket and its CORS, Resend's domain, the twelve crons and the Pro-tier requirement, the env matrix by stage, and the steps to run once a domain exists. |
| [`env.md`](env.md) | every environment variable the system reads, what reads it, whether it is required, and — the column that matters — what actually happens when it is absent. Plus the variables found in code but not in `.env.example`. |

The machine that runs the voice has its own kit: [`infra/mac/`](../../infra/mac/README.md)
for the Mac mini today, [`infra/box/`](../../infra/box/README.md) for the CUDA box (the DGX
Spark) that is the eventual target.

The one command that tells you which link of the chain is broken:

```bash
bash scripts/kami-doctor            # add --json, --only <check>, --skip <check>, --slug <slug>
```

Its own manual — every check, and what each failure means — is
[`scripts/doctor/README.md`](../../scripts/doctor/README.md).
