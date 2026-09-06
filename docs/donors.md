# What a donor is promised

Plain words, no marketing. If anything on this page turns out to be untrue of
what the software actually does, the software is wrong and we fix it.

A "kami" is an AI voice **for** a place — a creek, a watershed, a reservoir, a
ridge — built on public sensor readings. It is not the place, and it is not a
legal person. It cannot hold money and it cannot move money.

## What your money can do

- **Pay people for small, verifiable work on the ground.** Fixing a fence,
  photographing diversion structures, clearing a reach, running a session for a
  class. Every payment is against a posted bounty with a stated deliverable and
  a stated evidence requirement.
- **Be traced.** Every payment has a transaction hash on Base and a signed
  attestation naming who was paid, for what, and who judged it done.
- **Be reported.** You get an account of the month, listing all of it.

## What your money cannot do

- **It cannot make the creek run higher, the air clearer, or the drought end.**
  A kami reports readings and published bands. It never claims that a piece of
  work caused an ecological change it cannot measure, and when its own
  predictions are wrong it says so.
- **It cannot buy standing, rights, or a say in what the sensors report.**
- **It cannot move without two human signatures.** The agent proposes; two
  guardians sign; a relayer pays the gas. The agent has no signing key, the
  treasury tool it can see has no execute or sign function, and no payment has
  ever moved out of a Kami Safe on an agent's signature.
- **It cannot become a token, a share, or a price on a place.** No token, ever
  — not for governance, not for reputation, not for cosmetics. Nothing here has
  a price and we never state what a creek is "worth" (`docs/no-token.md`).
- **It cannot earn you a return.** A donation is a gift to a public purpose.

## What it costs to give

| how you give | fee | who takes it |
|---|---|---|
| card, through Stripe Checkout | **2.9 % + 30¢** | Stripe |
| Stripe stablecoin checkout, where offered | **1.5 %** | Stripe |
| USDC sent straight to the Safe | **nothing** | — (you pay Base gas, a fraction of a cent, which never reaches us) |

Kami takes nothing on top. The platform never holds your dollars: Stripe is the
merchant's processor, the wrapper converts to USDC, and the USDC lands in that
kami's Safe.

Both Stripe rates are the published figures and are checked against the live
account before the first real donation (`docs/verify.md` #13). The fee we
record against your donation is Stripe's own number from the charge's balance
transaction whenever Stripe gives it to us. When it does not, we use the rate
above and **record that the number is an estimate** — a guessed fee is never
allowed to look like a measured one.

## Who receives the money, and whether it is deductible

The merchant of record is whatever `config.legal_entity_name` says it is: a
nonprofit, a fiscal sponsor, or nothing yet. The donation page names it.

**If no wrapper is in place, the page says so and says your donation is not
tax-deductible.** Nobody here will imply otherwise. None of this is tax advice;
ask the wrapper for a receipt and ask your own advisor what it means.

## A human signs every payout

Two guardians — named people, listed on the kami's page — sign each payment
from their own wallets, on a screen that shows them the evidence, the
evaluation, the attestation, the amount and the recipient. Any one guardian can
pause the kami at any moment; two are needed to wake it again.

## The report

**Within 31 days of the end of each month you get an account of that month.**
It lists:

- the Safe's balance (or, honestly, that it could not be read — never a zero we
  invented);
- what came in, by rail, with the fees;
- **every payout**, with its amount, who it went to, its **Safe transaction
  hash**, its **attestation UID**, and thumbnails of the evidence;
- one paragraph in the kami's own voice, in which **every number is checked
  against the figures in the report** before it is published. If that check
  fails, you get a plain templated paragraph instead and the report tells you
  which one you are reading.

Two things can stop a report going out, and both are deliberate:

- **A blocked reconciliation.** Every night the ledger is compared with the
  chain. If they disagree, the report is held, a steward is paged, and nothing
  is published until the disagreement is resolved. A report is a promise about
  numbers; we do not send one when we do not know the numbers.
- **A failed send.** The report is not marked sent until the email actually
  goes out.

Coverage — how many donors of record actually received it — is counted and
published, not asserted.

The public version of the report is also published as a commons note. It
contains **no donor identity**: inflows appear by rail and in total, and who
gave is never published, there or anywhere.

## If you send USDC directly

Direct donations are **anonymous by default**. If you want yours attached to
your account and included in your monthly report, sign a short "this was me"
message from the wallet the money came from; we verify the signature against
that exact address and refuse anything else. Signing costs nothing and moves
nothing.

## No refunds

There are none. This is an experiment, and a gift to it is a gift, not a
purchase and not an investment. We would rather say that plainly on the way in
than discover we disagree with you about it later.

What you get instead of a refund is an account. Every payout this kami makes is
listed with the amount, who received it, the transaction hash and the
attestation that verified the work, and a report reaches you within 31 days of
each month's end whether or not anything was spent. If we spend your money on
something you think was foolish, you will be able to see exactly that, and say
so, and stop giving.

If a donation was a genuine mistake — a wrong amount, a wrong entity, a card
that was not yours — write to us. We will not hide behind this policy for
something that was an error rather than a change of mind, and we will tell you
what we can and cannot undo.

## Being forgotten

Write to us and say so.

- **Your email and your account** are deleted.
- **Your donations stay in the ledger, unattributed.** The amount, the date and
  the transaction are part of a public financial record that other people rely
  on; the link between them and you is removed, so `donations.donor_user_id`
  becomes null and no future report names you. Nothing that identified you was
  ever in the public report to begin with.
- **A transaction on Base cannot be deleted by anyone**, including us. If you
  sent USDC from a wallet that is publicly linked to you, that link is on a
  public chain and outside our reach. This is exactly why the card route
  exists and why direct donations are anonymous unless you choose otherwise.
- **Chats** are deleted after 90 days anyway unless you opted in to contribute
  them; you can delete them sooner from `/me`.
- **Evidence photos**, if you have contributed any, are removed on request
  except where an attestation references them — the file goes, the hash stays,
  because the attestation is a record somebody else relies on.

We do not collect personal data beyond your email, and — for people we *pay*
above the threshold — the tax form the law requires.

## What we will never do

- Tell you the creek will die without you, or put a countdown, a goal bar or a
  matched-gift banner in front of you.
- Pre-select an amount, or make a donation recurring by default. There is no
  recurring option at all: if you want to give again, you come back and decide
  again.
- Sell, share or publish who you are.
- Issue a token, or say a place has a price.

These are not preferences. They are binding rules in the product requirements
(§13 #2, #8), and the donation page has a test that fails the build if any of
the forbidden language appears on it.

## Where to ask

Reply to any report email, or write to the address on the kami's page. A
steward — a person — answers.
