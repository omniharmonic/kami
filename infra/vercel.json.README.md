# Where `vercel.json` lives

It is at **`apps/web/vercel.json`**, not here.

Vercel reads `vercel.json` from the **deployed project root**, and this project's
root directory is `apps/web`. A copy in `infra/` was read by nobody: the twelve
crons would silently not exist, which is the worst failure shape available —
the site looks fine and never wakes.

Edit `apps/web/vercel.json`. There is nothing to copy at deploy time.
