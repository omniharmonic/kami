# How to do a bounty

*A guide for the person doing the work. If you have found a task on a kami's board and want to do
it and get paid, this is everything you need to know before you start.*

---

## What a bounty is

A kami — an AI voice for a place — drafts small, concrete tasks that would help the place it speaks
for, once a week, from its current quarterly strategy. It **drafts** them; it cannot post one. A
human guardian reads each draft, edits it if needed, and approves it. Only then does it appear on
the board where you can see it.

Every bounty says, before you touch it: what to do, why the kami is asking, **exactly what evidence
will be accepted**, what the cap is in USDC, how many people can claim it, and when it is due. That
is deliberate. You should never be in the position of doing the work and then discovering the proof
was not good enough.

A bounty is a small amount of money for a small, checkable piece of work. It is not a job, not a
grant, and not an investment. There is no token — not for payment, not for reputation, not for
anything else. If something claims to be a Kami token, it is a scam.

## Claiming one

1. **Sign in.** An email address is all it takes: you get a link, you click it, you are in. There
   is no password and no wallet to set up. (You must be 13 or older.)
2. **Read the evidence spec** on the bounty page before you claim. It is the contract.
3. **Press "Claim this bounty."** Most bounties allow one claimant at a time; some allow several.
   Claiming reserves it for you.
4. **Do the work**, then submit your evidence from the same page.
5. **Release the claim** if you change your mind. That is fine and costs you nothing — leaving a
   claim to expire is worse for everyone than releasing it.

Two limits worth knowing up front: there is a **monthly cap** on how many claims one person can
hold across all kami, and bounties above a threshold require a **Human Passport** score above a
minimum. Both exist so that one person with many accounts cannot drain a treasury. Neither costs
money.

## The four evidence tiers

The tier tells you what will be accepted as proof. It is chosen by what the twin can actually
measure, not by how hard the work is.

### Tier 1 — the twin will show it

The best kind, and the rarest. The outcome appears in a public sensor reading: an air sensor starts
reporting to AirNow, a gauge that had gone quiet reports again. You do not have to prove anything;
the data does.

- **Evidence:** the reading itself, at the place and in the window the bounty names.
- **A tier-1 bounty always carries a prediction** — the place, the property, the direction it
  should move and by when — because the kami is scored on it too.
- **Pays:** full, and it carries the most reputation weight.

### Tier 2 — photographs with GPS and time

The common case: cleanups, fence repair, signage, invasive removal, surveying a structure.

- **Evidence:** original photographs with their EXIF intact, usually taken in the app, with GPS
  inside the radius the spec names, at least the minimum number the spec asks for.
- **Above 100 USDC, a second, independent evaluator must also attest.**
- **Pays:** full, standard reputation.

### Tier 3 — an evaluator's word

For things that leave no photograph and no reading: a talk, a class, a meeting attended.

- **Evidence:** an evaluator who was there attests to it.
- **Pays:** small, and it carries low reputation weight — not because the work is small, but
  because the proof is weak, and the system is honest about that.

### Tier 4 — you cannot know within the season

Riparian planting, habitat work: the outcome is a year away.

- **Evidence:** the work now, then a follow-up 6–12 months later.
- **Pays:** a **deposit on completion, the balance at the follow-up.** The reputation is deferred
  the same way. Read the follow-up date before you claim.

## EXIF and GPS, in plain words

**EXIF** is the little block of information your camera writes inside a photograph: when it was
taken, what took it, and — if location is on — where. It is invisible when you look at the picture
and travels inside the file.

**Why the bounty asks for it:** it is what makes a photograph evidence instead of a picture. It
shows that the photo was taken at that spot at that time, by a camera, not found on the internet or
taken last year.

**What breaks it, every time:**

- **Sending photos through a chat app.** WhatsApp, Signal, Messenger, iMessage and most social apps
  strip EXIF and re-compress the image. A photo that has been through one of those is not evidence
  any more.
- **Screenshotting a photo.** The screenshot has the time you took the screenshot, and no location.
- **Editing and re-exporting** in an app that drops metadata.
- **Location services being off** for the camera when you shot it. The time survives; the place
  does not.
- **AirDrop / email "small size" options** that re-encode the file.

**What to do instead:**

- **Use the in-app capture** on the bounty page whenever the spec says `capture: in_app`. It takes
  the photograph, hashes it on your phone before it goes anywhere, and keeps the metadata intact.
  It is the shortest path to an accepted claim.
- If you must use your own camera, transfer files with a **cable, or a cloud drive set to "original
  quality"** — never through a messaging app.
- Turn location on for the camera before you go.
- Shoot more than the minimum. Files are cheap; a second trip is not.

**GPS accuracy is not perfect and the spec knows it.** `gps_within_m: 50` means your photograph's
coordinates must be within fifty metres of the place. Under trees, in a canyon, or against a cliff,
phone GPS drifts — stand in the open for a moment before you shoot, and wait for the location to
settle.

**What the kami itself ever sees of your evidence: counts and your note, trimmed.** Not the images.
It is told how many photos you sent, how many had usable EXIF times, how many were inside the GPS
radius, how many were captured in-app, the span of capture times, and a note of up to 500
characters with links removed. That is a security rule, not a courtesy: text that reaches the model
is a place where someone could try to smuggle instructions to it.

## What "attested" means, and what it is worth

When an evaluator reviews your submission they record an outcome — succeeded, partial, failed, or
unverifiable — with public notes. That record is then **signed** as an EAS attestation: a small,
cryptographically signed statement that says *this evaluator, holding this role, judged this
submission this way, on this date*, linked back to the bounty it came from.

- It is **signed by a person**, not by the kami. The kami cannot attest to anything.
- It is **public and portable.** It belongs to you, not to this platform. Anyone, anywhere, can
  check it without asking us, and it keeps working if this project disappears.
- It is **cheap and permanent.** Evaluations are signed off chain, free to you, and their
  identifiers are timestamped on Base each night so the date cannot be moved afterwards.
- It is **revocable.** If an evaluator's key is later found to be compromised, attestations made
  after that moment are revoked and the reputation is recomputed without them. That is the honest
  design, and it means a track record can shrink as well as grow.

**What it is worth:** your reputation is a published function over these attestations — a Wilson
score of succeeded-against-attempted, decayed by age, weighted by the USDC at stake. It is
recomputed nightly and published **with the list of attestation identifiers it was computed from**,
so you can recompute it yourself and check ours. Tier 1 counts most, tier 3 least, tier 4 lands
when the follow-up does.

It is not a token, it does not convert to money, and it cannot be bought or sold. It is a record.

Bad outcomes are attested too. A failed claim follows you the same way a successful one does.

## Getting paid

1. Your submission is evaluated. Above the threshold, a second independent evaluator attests too.
2. The kami **proposes** the payment to its treasury. That is the only thing it can do with money.
3. **Two human guardians sign it.** Nothing moves on one signature, and the agent's key is not one
   of them — it can create a pending transaction and nothing else.
4. USDC arrives in a wallet made for you from your email address. You do not need to know anything
   about crypto, you never see a seed phrase, and you do not pay gas — the platform sponsors it.
   There is a one-click route to cash out.
5. A `BountyCompleted` attestation is published carrying the transaction hash, so the payment and
   the proof point at each other.

Expect **days, not minutes.** Two humans have to read something and sign it, and they have lives.

**Tax:** payments are income. Once your cumulative payouts approach the US reporting threshold you
will be asked for a W-9 (or W-8 if you are outside the US) before further payouts. We tell you the
threshold and collect the form; we do not give tax advice. Get your own.

## If your claim is rejected

Nothing dramatic happens. The evaluation is recorded with its outcome and the evaluator's public
notes, and:

- **"Unverifiable"** usually means the evidence did not meet the spec — EXIF stripped, GPS outside
  the radius, too few photos. It is the most common outcome and the most fixable. Where the bounty
  is still open and the deadline has not passed, **you can resubmit.** Ask the evaluator what was
  missing; the notes are public and are meant to tell you.
- **"Partial"** means some of the deliverable was met. Partial work can be paid partially, at the
  guardians' discretion.
- **"Failed"** means the work was not done as specified. No payment.
- A rejected claim **releases the bounty** so someone else can take it, if the deadline allows.

**Every outcome is attested, including this one.** A rejection is part of your public record, which
is exactly why the evidence spec is printed before you claim and why you should read it first.

**If you think the evaluation is wrong:** say so to a guardian, whose name and contact are on the
kami's page. Ten per cent of tier-2 evaluations are re-checked by a second evaluator at random
anyway, and a guardian can order an audit of any of them. An evaluator may never evaluate their own
claim or a bounty they proposed — that is enforced by the database, not by good manners.

## The evidence licence

You accept it at upload, and this is what it says:

- You **took these photographs yourself**, at the place and time they show.
- You license them to the kami's steward organisation under **CC BY 4.0**, so they can appear in
  reports and on the kami's page, credited to your display name.
- You may **ask for a photo to be removed at any time**. It will be deleted. Where a signed
  attestation references it, its hash stays on the record — otherwise the attestation would stop
  being checkable — but the file itself goes.
- **Do not photograph people's faces, licence plates, or anything you do not have the right to
  share.**

Two more things in the same spirit: photographs are hashed on your device before upload, so the
hash in the attestation is of the file you actually took; and files are limited to 50 MB each, 30
per submission.

## A short checklist before you start

- [ ] Read the evidence spec, not just the title.
- [ ] Check the deadline, and for tier 4, the follow-up date.
- [ ] Turn location on for your camera.
- [ ] Plan to use in-app capture if the spec asks for it.
- [ ] Claim it before you do the work, so nobody duplicates your effort.
- [ ] Take more photographs than the minimum.
- [ ] Never send them through a messaging app.
- [ ] Submit before the deadline; evaluation takes days.

---

*Questions, or something that looks wrong: the guardians are named on every kami's page and any one
of them can pause the whole thing while a question is answered. See also `docs/how-i-work.md` and
`docs/no-token.md`.*
