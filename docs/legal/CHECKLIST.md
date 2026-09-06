# Legal wrapper checklist

**Status: nothing on this list is done.** Every box below is unticked, and that is the current,
accurate state of the project.

> ## The hard gate
>
> **No mainnet Safe and no live Stripe until every box on this list is ticked.**
>
> Until then the project runs on **Base Sepolia** (a test network, where the tokens have no value)
> and **Stripe test mode** (where no card is ever charged). Those are enforced by configuration —
> `CHAIN_ID=84532` and Stripe test keys — and by this document, which is the record of why.
>
> Ticking a box means: a named owner has done the thing, there is a document or a receipt, and the
> date is written down. It does not mean someone read about it.

---

## For counsel reading this cold

**What the project is.** Kami is open-source software that gives a place — a creek, a watershed —
an AI voice built entirely on public sensor readings published by a separate civic-data project
(the Front Range Bioregional Twin). Each "kami" has a web page with live readings, a chat, and a
small public treasury. It is explicitly **not** a legal person, claims no standing, and says so on
every page.

**What money does.** People may donate. Donations sit in a per-place multisignature wallet
("Safe") on the Base blockchain, denominated in USDC, a US-dollar stablecoin. The software drafts
small task descriptions ("bounties") and *proposes* payments to people who complete them; **two
human signatures are required for any payment to move**, and the software holds no key that can
sign. Donors receive a monthly report listing every payout with its transaction hash.

**What we need from counsel.** Four decisions, in this order: (1) what legal entity holds the money
and the liability; (2) whether soliciting donations in Colorado requires registration, and where
else; (3) that the payment design does not make us a money transmitter; (4) that the terms of
service, the AI-disclosure duties and the tax reporting are right. The rest of this list is the
work that follows from those answers.

**Three facts that shape all four.** (a) We never take custody of anyone's fiat currency — card
payments go to a payment processor which converts and settles; we hold only our own funds. (b) The
software cannot move money; every transfer needs two humans. (c) There is **no token**: nothing is
issued, sold, or given that could be a security, and no place is ever assigned a price. That is a
binding product rule, not a phase.

---

## 1. Entity choice — who holds the money and the liability

**Owner:** the project owner, with counsel.
**Blocks:** everything else on this list. Do this one first.

| # | Item | Owner | Done |
|---|---|---|---|
| 1.1 | Decide the wrapper: **platform nonprofit**, **fiscal sponsor**, or **per-entity association**. Record the decision and the reasoning in this file. | owner + counsel | ☐ |
| 1.2 | If a platform nonprofit: incorporate; adopt bylaws; seat a board; apply for 501(c)(3) recognition; obtain an EIN; open a bank account. | owner + counsel | ☐ |
| 1.3 | If a fiscal sponsor: sign the sponsorship agreement; confirm in writing that the sponsor **accepts cryptocurrency donations and can hold or receive USDC**, and at what fee. | owner | ☐ |
| 1.4 | If per-entity associations: confirm an unincorporated nonprofit association can hold the Safe under Colorado law, and who is personally exposed if it cannot. | counsel | ☐ |
| 1.5 | Confirm which entity is the **counterparty on the terms of service**, the **licensee of contributor evidence**, and the **data controller** for chat logs and email addresses. These may not be three different answers by accident. | counsel | ☐ |
| 1.6 | Directors-and-officers and general liability cover, or a written decision to go without and why. | owner | ☐ |
| 1.7 | Decide who signs on behalf of the entity, and record that the guardians' signing keys are **not** the entity's authority to contract. | owner + counsel | ☐ |

### The trade-offs, stated plainly

**A. Platform nonprofit (our own 501(c)(3))**

- **For:** full control of the mission and the money; donations are tax-deductible in our own name;
  no percentage taken by anyone; we can hold the Safe directly; it survives the founder, which is a
  stated product goal (G8).
- **Against:** the slowest and most expensive route — incorporation, an IRS determination that can
  take months, a real board, annual filings, state charitable registration, bookkeeping, and an
  ongoing administrative burden that falls on a very small team. Most banks and payment processors
  are cautious with a new nonprofit that holds cryptocurrency.
- **Choose it if:** this is a long-lived institution with more than one place and someone willing to
  do governance work.

**B. Fiscal sponsor**

- **For:** fastest to a legal, tax-deductible home for donations; the sponsor's determination
  letter, bank account and compliance apparatus are already in place; someone else does the
  charitable registration and the 1099s. Two commonly cited options carry roughly 1.5 % and 7 % of
  funds respectively; the cheaper one is crypto-native, the more expensive one is a general-purpose
  sponsor.
- **Against:** the sponsor owns the funds and can say no; their policies bind us, including on
  cryptocurrency, which several sponsors will not touch; the fee is real and permanent; leaving
  later means moving the money and possibly renegotiating with every donor; and we do not control
  whether the sponsor will let a **multisignature wallet signed by volunteers** hold charitable
  assets. **That last question is the one to ask first and get in writing.**
- **Choose it if:** the goal is to be live within a quarter and to defer the institution-building.

**C. Per-entity association (one wrapper per place)**

- **For:** matches the product's shape — each kami is a distinct place with its own guardians and
  its own money; failure is contained; local guardians can be the local association; it is the most
  honest expression of "this money belongs to this creek's community".
- **Against:** multiplies everything — registration, tax filing, bookkeeping, bank accounts — by
  the number of places; unincorporated associations may not be able to hold assets or contract in
  every state; donations are probably not deductible; each new place becomes a legal project rather
  than a software one; and it is the hardest to explain to a donor.
- **Choose it if:** the model is genuinely federated and each place's community is already
  organised. **Not a starting position.**

**A note on the hybrid:** a platform nonprofit holding all Safes, with a written per-place
restricted-fund policy, gets most of C's honesty with A's overhead and none of C's multiplication.
If counsel is comfortable with restricted funds, it is worth costing.

---

## 2. Colorado charitable-solicitation registration

**Owner:** counsel.
**Note:** Colorado requires registration with the Secretary of State before soliciting charitable
contributions, with limited exemptions, and paid solicitors register separately. This is
*verify* — nobody on the build side has confirmed the current thresholds or exemptions.

| # | Item | Owner | Done |
|---|---|---|---|
| 2.1 | Confirm whether the chosen wrapper must register with the Colorado Secretary of State before soliciting, and whether any exemption applies. | counsel | ☐ |
| 2.2 | File the registration (or record the exemption relied on, in writing, with its citation). | owner | ☐ |
| 2.3 | Decide whether a **public website with a donate button** constitutes solicitation in other states, and apply the Charleston Principles or their successor to that question. | counsel | ☐ |
| 2.4 | Register in every other state where registration is triggered, or restrict solicitation to those where it is not. | owner | ☐ |
| 2.5 | Add required disclosures to the donation page (registration number, where financial statements can be obtained, any state-mandated wording). | owner | ☐ |
| 2.6 | Calendar the annual renewals and the annual financial report. | owner | ☐ |
| 2.7 | Confirm the position for donations **in cryptocurrency** rather than fiat — whether they are solicitations of the same kind and how they are valued for reporting. | counsel | ☐ |

---

## 3. Money-transmission posture — we never custody fiat

**Owner:** counsel.
**The design's claim:** we do not take, hold, or transmit anyone else's money. Card donations go to
Stripe, which converts and settles to us; we hold only our own funds; every outward payment is
signed by two humans from our own treasury. Counsel must confirm that this is what the design
actually does before any of it goes live.

| # | Item | Owner | Done |
|---|---|---|---|
| 3.1 | Confirm we are **not** a money transmitter under the Colorado Money Transmitters Act, given that we never hold a donor's funds pending transmission to a third party. | counsel | ☐ |
| 3.2 | Confirm the same under FinCEN's rules — and specifically that paying a contractor from our own treasury in USDC is not money transmission. | counsel | ☐ |
| 3.3 | Confirm that the payment processor's stablecoin settlement leaves us on the right side of that line, and that its terms of service permit our use. | counsel | ☐ |
| 3.4 | Confirm the position on the **platform-operated relayer** that pays gas and submits transactions that two humans have already signed: it is a courier, not a custodian. Get this in writing; it is the least obvious box on this list. | counsel | ☐ |
| 3.5 | Confirm the position on the **embedded wallets** created for recipients from their email address: who controls them, who can recover them, and whether creating one for someone makes us a custodian of their assets. | counsel | ☐ |
| 3.6 | Sanctions screening: what we must do before paying a person in USDC, and how it is recorded. | counsel | ☐ |
| 3.7 | Write the answer to 3.1–3.6 into an operating memo that names the facts it relies on, so a change in the design triggers a re-read. | counsel | ☐ |
| 3.8 | Confirm we may state publicly that donations are **not** refundable and **not** an investment, and that no return is offered. | counsel | ☐ |

---

## 4. Terms of service, and the two policies inside them

**Owner:** counsel drafts; owner publishes.

| # | Item | Owner | Done |
|---|---|---|---|
| 4.1 | Terms of service naming the contracting entity, the governing law and the venue. | counsel | ☐ |
| 4.2 | Privacy policy covering: email addresses, chat logs kept 90 days, hashed IP addresses used only for rate limits, evidence photographs, and the fact that no data is sold and no analytics cookies are set. | counsel | ☐ |
| 4.3 | **Evidence licence** in the terms, matching the words shown at upload: the contributor warrants they took the photographs; grants CC BY 4.0 to the steward organisation; may request removal at any time, with the file deleted and only its hash retained where an attestation references it; and must not photograph faces, licence plates, or anything they lack the right to share. | counsel | ☐ |
| 4.4 | **"No token, ever"** stated in the terms as a binding commitment, not marketing: no token is or will be issued for governance, reputation, cosmetics or access; nothing offered is a security; no place is assigned a price. | counsel | ☐ |
| 4.5 | Contributor terms: bounty payments are for services, the payee is an independent contractor, and there is no employment relationship. | counsel | ☐ |
| 4.6 | Acceptable-use terms and a removal policy for contributed content. | counsel | ☐ |
| 4.7 | Age gate: 13+, declared at sign-up, no accounts below, and the COPPA position recorded. | counsel | ☐ |
| 4.8 | Disclaimer that readings come from third-party public sensors, may be wrong or stale, and are not advice — safety, engineering, legal or otherwise. | counsel | ☐ |
| 4.9 | Confirm the licence claims we publish: facts CC0, prose CC BY-SA 4.0 with attribution, code Apache-2.0, evidence CC BY 4.0 — and that we have the right to make each one. | counsel | ☐ |
| 4.10 | Statement that the kami is software, speaks **for** a place and never **as** one, claims no legal standing, and represents no agency, landowner, or Tribe. | counsel | ☐ |
| 4.11 | DMCA agent registered, if the terms accept user content. | owner | ☐ |

---

## 5. 1099 handling and the `config.tax_collector` switch

**Owner:** owner, with the wrapper's bookkeeper.
**The switch:** the platform holds one configuration value, `config.tax_collector`, naming **who is
responsible for tax reporting on payouts**. If a fiscal sponsor pays the contributors, it is set to
the sponsor and the platform collects nothing. If the platform's own entity pays, it is set to that
entity and the platform must collect the forms and file. **It has no default. It must be set before
the first payout, and setting it is a legal decision, not a configuration change.**

| # | Item | Owner | Done |
|---|---|---|---|
| 5.1 | Decide who the tax collector is, and set `config.tax_collector` to that entity. | owner + counsel | ☐ |
| 5.2 | Confirm the current reporting threshold and the tax year it applies to (the build assumes $2,000 for tax year 2026 — *verify*). | counsel | ☐ |
| 5.3 | Set the collection trigger below the threshold — the build prompts for a W-9 or W-8 at $1,500 cumulative — and confirm the number. | owner | ☐ |
| 5.4 | A W-9 / W-8BEN collection flow that does not put a tax identification number anywhere the platform stores it. **The platform must not hold TINs; the tax collector holds them.** | owner + counsel | ☐ |
| 5.5 | Confirm the treatment of payment **in USDC**: valuation at payment, what the recipient is told, and what appears on the form. | counsel | ☐ |
| 5.6 | Confirm the treatment of **non-US recipients** and any withholding obligation. | counsel | ☐ |
| 5.7 | Backup withholding position where a form is not returned. | counsel | ☐ |
| 5.8 | Confirm the treatment of **donations received in cryptocurrency**: acknowledgement letters, valuation, and Form 8282 / 8283 obligations. | counsel | ☐ |
| 5.9 | Year-end process, calendared, with a named human who runs it. | owner | ☐ |

---

## 6. SB 243 — the California companion-chatbot statute

**Owner:** counsel; the product already implements the duties.
**Posture:** the project treats itself as **in scope**. The avatar is deliberately appealing and
minors will find it. The build does not argue about whether the statute applies; it complies.

| # | Item | Owner | Done |
|---|---|---|---|
| 6.1 | Confirm the posture: are we an operator of a companion chatbot platform under SB 243, and does the statute reach us? | counsel | ☐ |
| 6.2 | Confirm the **disclosure cadence** for minors. The build reminds every 12 turns (`config.reminder_every_turns`), which is a guess, not a legal finding — *verify*. | counsel | ☐ |
| 6.3 | Confirm the crisis-protocol requirements and that the implemented template and resources satisfy them. | counsel | ☐ |
| 6.4 | Determine the **annual report** content, its recipient and its deadline; set `config.sb243_report_due`. | counsel | ☐ |
| 6.5 | File the first annual report. | owner | ☐ |
| 6.6 | Record the operator's own position on minors: no accounts under 13, no direct messages, no companionship framing. | owner | ☐ |
| 6.7 | Track **Colorado SB 189** (signed 2026-05-14, effective 2027-01-01) and diary a review before it takes effect. | counsel | ☐ |

---

## 7. EU AI Act Article 50 — transparency marking

**Owner:** counsel; the product already implements the duties.
**Note:** Article 50 has applied since 2026-08-02, with penalties up to €15M or 3 % of worldwide
turnover. It bites if the service is available to people in the EU.

| # | Item | Owner | Done |
|---|---|---|---|
| 7.1 | Decide whether the service is offered in the EU at all. If not, record how that is enforced; if yes, the rest of this section applies. | owner + counsel | ☐ |
| 7.2 | Confirm the **persistent disclosure label** satisfies Article 50(1): a person is informed they are interacting with an AI system. | counsel | ☐ |
| 7.3 | Confirm the **machine-readable marking** of generated content satisfies Article 50(2). The build marks reply nodes `data-generated="ai"` in the HTML and sets `generated_by: entity-agent` in the frontmatter of anything published to the commons — *verify* that these are accepted markers, or replace them with whatever the adopted standard turns out to be. | counsel | ☐ |
| 7.4 | Confirm no deployer-side obligation is missed for text published as public-interest information. | counsel | ☐ |
| 7.5 | Confirm the GDPR position if any EU user reaches the service: lawful basis, retention, data-subject rights, and whether a representative in the Union is required. | counsel | ☐ |
| 7.6 | Confirm that the AI system is not, on these facts, high-risk under any other part of the Act. | counsel | ☐ |

---

## 8. Before the switch is thrown

The last five boxes. Nothing here is legal work; it is the evidence that the legal work landed in
the software.

| # | Item | Owner | Done |
|---|---|---|---|
| 8.1 | Every box in sections 1–7 is ticked, dated, and has a document behind it. | owner | ☐ |
| 8.2 | The published terms of service, privacy policy and evidence licence match the words the software actually shows at sign-up and at upload — checked by reading both. | owner | ☐ |
| 8.3 | `config.tax_collector` is set; `config.sb243_report_due` is set. | owner | ☐ |
| 8.4 | The chain configuration is moved from Base Sepolia to Base mainnet **in one reviewed change**, and the Safe's owners and 2-of-3 threshold are verified on chain afterwards. | owner | ☐ |
| 8.5 | Stripe is switched from test mode to live keys, with webhook signatures and idempotency verified against the live endpoint. | owner | ☐ |

---

## Record of decisions

*Fill this in as boxes are ticked. A decision with no date and no name is not a decision.*

| Date | Section | Decision | Who | Document |
|---|---|---|---|---|
| | | | | |

---

*This checklist is drawn from the project's implementation plan (T2.0, T2.16) and its architecture
(§7.8, §11). It is a work plan for obtaining legal advice. It is not legal advice, and nobody who
wrote it is a lawyer.*
