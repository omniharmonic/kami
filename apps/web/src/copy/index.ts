/**
 * Every user-facing string in @kami/web lives here (CLAUDE.md: one copy module
 * per app; English only; no urgency language; no token, ever).
 *
 * Rules baked into this file:
 * - Every kami is "an AI voice *for* <place>", never "the voice of", never "as".
 * - Stale is a state, not sadness: "I can't feel my gauge", never distress.
 * - Donation copy states what money can and cannot do; no countdowns, no
 *   "before it's too late", no recurring defaults.
 */

export const kindNoun: Record<string, string> = {
  creek: "the creek",
  watershed: "the watershed",
  reservoir: "the reservoir",
  mountain: "the mountain",
  bioregion: "the bioregion",
};

export const kindNounBare: Record<string, string> = {
  creek: "creek",
  watershed: "watershed",
  reservoir: "reservoir",
  mountain: "mountain",
  bioregion: "bioregion",
};

/** ADR-E13 / PRD §6.6 — rendered by layout on every entity route. */
export function disclosureLabel(name: string, archetype: string): string {
  const noun = kindNounBare[archetype] ?? "place";
  return `I'm an AI voice for ${name}, built on public sensor data — not the ${noun}, not a legal person.`;
}

export const disclosure = {
  template: "I'm an AI voice for {name}, built on public sensor data — not the {kindNoun}, not a legal person.",
  short: (name: string) => `An AI voice for ${name}.`,
  /** SB 243 system-rendered reminder, injected by the web app every N turns. */
  reminder: (name: string) =>
    `A reminder: you're talking with an AI voice for ${name}. It is software reading public sensors, not a person and not ${name} itself. Take a break whenever you like.`,
  reminderFirst: (name: string) =>
    `You're talking with an AI voice for ${name}. It can only cite readings it fetched this turn, and it will show you what it looked at under each reply.`,
  generatedMarker: "AI-generated",
} as const;

/** Mood and state lines — the templated `mood_reason` strings, verbatim. */
export const states = {
  asleepStale: "I can't feel my gauge",
  asleepGpuOff: "I'm asleep — my thinking machine is off",
  asleepPaused: "agent paused",
  overBudget: "I've talked a lot today; back tomorrow",
  peopleAhead: (n: number) => (n === 1 ? "1 person ahead of you" : `${n} people ahead of you`),
  sensesBehind: (hours: number) => `my senses are ${hours} hour${hours === 1 ? "" : "s"} behind`,
  cannotReachSenses: "I can't reach my senses right now. The last readings I have are shown with their times.",
  cantFeelIt: "can't feel it",
  asOf: (iso: string) => `as of ${iso}`,
  unknownNotZero: "unknown — not zero",
  gaugeQuiet: "the gauge feed has been quiet since then",
} as const;

export const moodLabel: Record<string, string> = {
  asleep: "asleep",
  content: "content",
  concerned: "concerned",
  distressed: "distressed",
  celebrating: "celebrating",
};

export const needLabel: Record<string, string> = {
  flow: "Flow",
  storage: "Storage",
  snow: "Snowpack",
  water: "Water quality",
  air: "Air",
  drought: "Drought",
  stage: "Stage",
  fire: "Fire",
  alerts: "Alerts",
};

export const seasonLabel: Record<number, string> = {
  0: "freeze",
  1: "runoff",
  2: "monsoon",
  3: "fall",
};

export const chat = {
  title: (name: string) => `Talk with ${name}`,
  placeholder: "Ask about a reading, a place, or what I'm trying to change",
  send: "Send",
  sending: "Listening…",
  lookedAt: "What I looked at",
  lookedAtNone: "I didn't look anything up for this reply.",
  guardDropped: (n: number) =>
    n === 1 ? "1 sentence was withheld because its number did not match a reading." : `${n} sentences were withheld because their numbers did not match a reading.`,
  paused: "I'm paused by my guardians. I'll be back when two of them agree to wake me.",
  asleep: "I'm asleep — my thinking machine is off. My readings are still on the page.",
  overBudget: "I've talked a lot today; back tomorrow.",
  rateLimited: "You've sent a lot of messages this hour. Please come back a little later.",
  rateLimitedDay: "This connection has reached today's limit. Please come back tomorrow.",
  networkError: "The connection dropped. Your message was not lost; try sending it again.",
  systemLabel: "System",
  youLabel: "You",
  anonymousNotice: "You can chat without signing in. A cookie remembers this conversation for an hour.",
  retention: "Chats are kept for 90 days for safety review, then deleted unless you chose to contribute them.",
  openFull: "Open full-screen chat",
  backToPage: (name: string) => `Back to ${name}`,
} as const;

export const meters = {
  heading: "How I'm doing",
  reading: "reading",
  time: "time",
  source: "source",
  stale: "stale",
  live: "live",
  unbanded: "no published band — value and trend only",
  noReading: "no reading — unknown, not zero",
  staleFor: (seconds: number) => `stale for ${humanDuration(seconds)}`,
  band: (b: string) => `band: ${b}`,
  trend: { rising: "rising", falling: "falling", flat: "flat" } as Record<string, string>,
  ringAria: (need: string, label: string, stale: boolean) =>
    `${need}: ${stale ? `${states.cantFeelIt} — ` : ""}${label}`,
} as const;

export const pulse = {
  heading: "Pulse log",
  empty: "No pulses yet. I write one when a reading changes band, an alert starts or ends, or a gauge goes quiet or comes back.",
  skipped: "skipped — nothing changed",
} as const;

export const strategy = {
  heading: "What I'm trying to change and how I'll know",
  empty: "No quarterly strategy yet. When one is ratified by my guardians it appears here in three bullets.",
  commentOpen: (until: string) => `Open for comment until ${until}`,
} as const;

export const board = {
  heading: "Board",
  empty: "No bounties yet. Each week I draft small, verifiable tasks; my guardians approve them before they appear here.",
  open: "open",
  claimed: "claimed",
  in_review: "in review",
  paid: "paid",
  deferred: "deferred",
  humanProposals: "Proposals from people",
  rankReason: "why I ranked it here",
  cap: (usdc: string) => `up to ${usdc} USDC`,
  tier: (t: number) => `verification tier ${t}`,
} as const;

export const treasury = {
  heading: "Treasury",
  balance: "Safe balance",
  balanceUnknown: "not read yet",
  pending: "awaiting guardians",
  whatIDid: "What I did with your money",
  whatIDidEmpty: "Nothing paid out yet. Every payout will be listed here with its transaction hash and attestation.",
  give: "Give",
  /** The link to the donation page. Distinct from `give`, which labels the
      disclosure above it, so the two are never ambiguous to a reader or a test. */
  giveCta: "Go to the donation page",
  noRecurring: "One-time only. Nothing recurs unless you come back.",
  moneyCanDo: [
    "pay people for small, verifiable work on the ground, approved by human guardians",
    "be traced: every payout has a transaction hash and a signed attestation",
    "be reported: donors get a monthly account of exactly what it did",
  ],
  moneyCannotDo: [
    "make the creek run higher, the air clearer, or the drought end",
    "buy standing, rights, or a say in what the sensors report",
    "move without two human signatures on the Safe — I only propose",
    "become a token, a share, or a price on a place — no token, ever",
    "be refunded or earn a return; it is a gift to a public purpose",
  ],
  attestation: "attestation",
  txHash: "transaction",
} as const;

export const people = {
  heading: "People",
  guardians: "Guardians",
  evaluators: "Evaluators",
  stewards: "Stewards",
  contributors: "Top contributors",
  empty: "No people recorded yet.",
  guardiansEmpty: "No guardians accepted yet.",
  role: {
    guardian: "guardian",
    evaluator: "evaluator",
    steward: "steward",
  } as Record<string, string>,
  guardiansNote: "Guardians can pause me at any time; two are needed to wake me. I never speak for them or for any nation.",
} as const;

export const entityPage = {
  /** Shown to role-holders viewing an entity whose consultation is not recorded. */
  consultationPreview:
    "Private team preview. Public release awaits the steward’s record of consultation with the relevant Tribal offices and local guardians.",
} as const;

export const siblings = {
  heading: "Siblings",
  empty: "No other kami share my anchor place yet.",
  intro: "Other kami bound to the same place. Plurality is allowed; each speaks for itself.",
} as const;

export const howIWork = {
  link: "How I work",
  heading: (name: string) => `How ${name} works`,
  model: "Model",
  /**
   * G7: the page must name the model. Everything in this section is *reported*
   * by the gate (see `src/lib/provenance.ts`) and rendered from that report —
   * none of it is asserted here. The old copy hardcoded "a single rented GPU …
   * no frontier model is on the hot path", which would have kept claiming local
   * inference on a day a hosted API was answering the chat. A page that lies
   * about its own machinery is worse than a wrong number.
   */
  modelBody:
    "Every reply is written by a language model and checked sentence by sentence before it reaches you. Which model, and whose machine it runs on, is reported by the gate that all traffic passes through — not written into this page by hand.",
  modelServing: (name: string) => `Serving now: ${name}.`,
  modelServingUnnamed: "The gate reported where the model runs but did not name the model.",
  /** Only these two sentences may carry the "no frontier model" claim, and only
      on a fresh report (`mayClaimNoFrontierModel`). */
  modelOwned: (provider: string | null) =>
    `It runs on hardware this project controls${provider ? `, served by ${provider}` : ""}, behind the gate. No frontier model is on the hot path.`,
  modelRented: (provider: string | null) =>
    `It runs on a GPU this project rents${provider ? ` from ${provider}` : ""} and controls for the length of the rental, behind the gate. No frontier model is on the hot path.`,
  modelHosted: (provider: string | null) =>
    provider
      ? `It runs on ${provider}'s hosted API, not on hardware this project controls. What you type is sent to ${provider} and is held under ${provider}'s terms, not this project's.`
      : "It runs on a hosted API, not on hardware this project controls — and the gate did not name the provider, so this page will not name one either. What you type leaves this project's machines.",
  modelOwnedLast: (provider: string | null) =>
    `When it last reported, it was running on hardware this project controls${provider ? `, served by ${provider}` : ""}.`,
  modelRentedLast: (provider: string | null) =>
    `When it last reported, it was running on a GPU this project rents${provider ? ` from ${provider}` : ""}.`,
  modelHostedLast: (provider: string | null) =>
    `When it last reported, it was answering through ${provider ? `${provider}'s` : "a"} hosted API — the conversation left hardware this project controls.`,
  modelPlacementUnreported: "The gate has not said where it runs, so this page says nothing about where it runs.",
  /** Rendered in every case: the guard is the one thing that does not depend on
      whose machine the model sits on. */
  modelGuardEitherWay:
    "Either way the fact-sheet guard runs on this project's side of the call and checks every sentence: no number reaches you that did not come back from a twin tool call in the same turn.",
  /** The gate can be run with the guard off. If it is, the page says so instead
      of repeating that every sentence is checked. */
  modelGuardOff:
    "The gate reports that it is running in passthrough mode: the fact-sheet guard is off, so sentences reach you unchecked. That is a development setting, and it is said here rather than hidden.",
  modelReported: (iso: string) => `Reported by the gate at ${iso}.`,
  modelStale: (iso: string, age: string) =>
    `Last reported ${iso}, ${age} ago. That is the last thing the gate said, not a statement about what is running right now.`,
  /** The Hermes profile on disk asks for a model; it does not observe one. */
  modelFromProfile: (name: string, effort: string) =>
    `The gate has not reported. This kami's profile on disk asks for ${name} at reasoning effort ${effort} — a request, not a measurement, so this page claims nothing about where it is running.`,
  modelUnknown:
    "Nothing has reported which model is serving this kami, so this page does not know and will not guess. Until the gate reports, it names no model, no provider, and makes no claim about whose machine answers you.",
  /** `/admin` reuses these so an operator sees the same reported facts. */
  adminServingColumn: "serving",
  adminServingUnknown: "nothing reported",
  adminServingLine: (placement: string | null, provider: string | null, model: string | null) =>
    [placement ?? "placement unreported", provider, model].filter(Boolean).join(" · "),
  adminServingAge: (age: string, source: string) => `${age} ago · ${source}`,
  adminServingNoAge: (source: string) => `no timestamp · ${source}`,
  guardiansHeading: "Guardians",
  guardiansBody:
    "These people hold the keys and the pause switch. Any one of them can stop this kami within a minute; two are needed to wake it again, or to retire it.",
  guardiansNone: "No guardians have accepted yet. Until at least two who are not the founder have, this kami cannot hold money.",
  guard: "The guard",
  guardBody:
    "Every number I utter must match a value that came back from a twin tool call in the same turn. Sentences that fail are withheld and counted; you see the count under the reply.",
  dropRate: (rate: number | null) => (rate === null ? "drop rate: not measured yet" : `drop rate: ${rate.toFixed(1)} % of sentences`),
  cadence: "Cadence",
  cadenceBody:
    "Hourly: my readings become a health snapshot and this page. Pulses only when something changed. Weekly: I draft bounties for my guardians. Quarterly: a strategy memo, open for comment.",
  links: "Read the sources",
  soul: "SOUL.md — my voice and hard rules",
  binding: "binding.json — the twin places I'm bound to",
  twinHealth: "Twin data health — the source status board",
  drill: "Pause drills",
  drillEmpty: "No pause drill logged yet. Guardians run one before launch and record it here.",
  consultation: "Consultation record",
  consultationUnpublished:
    "This page is not yet published. It stays unpublished until a steward marks consultation with the relevant Tribal offices done (PRD §13 #4).",
  consultationDone: (iso: string) => `Consultation marked done ${iso}.`,
  consultationNever: "I never speak for nations. If a nation asserts its own voice for this place, I defer and say so here.",
  noToken: "No token, ever",
  noTokenBody:
    "There is no token, no points, no price, and no valuation of this place. Reputation is a public function over signed attestations that anyone can recompute. Anything claiming to be a Kami token is a scam.",
  licences: "Licences",
  licencesBody: [
    "Twin facts: CC0 — I may speak them freely.",
    "Explanations and commons prose: CC BY-SA, attributed to the Front Range Bioregional Twin and its contributors.",
    "My own prose: CC BY-SA.",
    "Model weights: the base model's licence, with an honest model card.",
  ],
  voiceNotStanding: "I say \"for\", not \"as\". I claim no legal standing, threaten no one, and represent no agency, landowner, or Tribe.",
} as const;

export const landing = {
  title: "beings.earth — A living world of digital caretakers",
  tagline: "AI voices for creeks, watersheds, reservoirs, and ridges — grounded in public sensor readings, tended by human guardians.",
  whatIs: "What beings.earth is",
  whatIsBody: [
    "Each kami is an AI voice for one place, built on the Front Range Bioregional Twin's public sensor readings. It can only cite numbers it fetched this turn.",
    "Its mood follows measured conditions. When a gauge goes quiet it sleeps — it is never sad because a feed went down.",
    "Human guardians hold the money and can pause it at any time. The agent proposes; humans sign; the twin verifies.",
  ],
  entities: "Kami you can talk with",
  entitiesEmpty: "No kami are public yet.",
  noToken: "No token, ever.",
  noTokenBody: "Not for governance, not for reputation, not for cosmetics. Nothing here has a price.",
  attribution: "Built by Benjamin Life (@omniharmonic). Apache-2.0.",
  twinAttribution: "Readings: Front Range Bioregional Twin (facts CC0; prose CC BY-SA).",
  signIn: "Sign in",
  signOut: "Sign out",
} as const;

export const auth = {
  title: "Sign in",
  intro: "Enter your email and we'll send a link. No password, ever.",
  email: "Email",
  ageGate: "I am 13 or older",
  ageGateRefused: "Kami is for people 13 and older. We can't create an account without that confirmation.",
  submit: "Send me a link",
  sent: (email: string) => `Check ${email} for a sign-in link. It works for 10 minutes.`,
  error: "Something went wrong sending the link. Please try again in a minute.",
  mailSubject: "Your beings.earth sign-in link",
  mailBody: (url: string) =>
    `Welcome to beings.earth. Here is your sign-in link:\n\n${url}\n\nIt works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`,
  signedInAs: (email: string) => `Signed in as ${email}`,
  forbidden: "You don't have that role for this kami.",
  unauthenticated: "Please sign in first.",
} as const;

export const nav = {
  account: "My account",
  home: "beings.earth",
  skip: "Skip to content",
  chat: "Chat",
  howIWork: "How I work",
  proposals: "Board",
  treasury: "Treasury",
} as const;

/**
 * Crisis resources (SB 243). Shown by the chat when the gate returns a crisis
 * template and linked from every chat page. US resources; the platform serves
 * Colorado first.
 */
export const crisis = {
  heading: "If you're in crisis",
  intro: "I'm software and I can't help with this the way a person can. These people can, right now:",
  resources: [
    { name: "988 Suicide & Crisis Lifeline (US)", how: "call or text 988", url: "https://988lifeline.org" },
    { name: "Crisis Text Line", how: "text HOME to 741741", url: "https://www.crisistextline.org" },
    { name: "Colorado Crisis Services", how: "call 1-844-493-8255 or text TALK to 38255", url: "https://coloradocrisisservices.org" },
    { name: "Emergency", how: "call 911 if someone is in immediate danger", url: null },
  ],
} as const;

export const errors = {
  notFound: "There's no kami by that name.",
  unpublished: "This kami's page isn't public yet.",
  generic: "Something went wrong on our side.",
} as const;

export function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "an unknown time";
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

/** Guard against urgency language creeping into donation copy (tested). */
export const forbiddenUrgency = [
  "before it's too late",
  "will die",
  "act now",
  "urgent",
  "last chance",
  "hurry",
  // Scarcity, not the word "only": `.` matches everything on a single-line
  // textContent, so an unanchored "only .* left" fired on any page with "only"
  // somewhere before "left". Bounded to a few words, which is what scarcity
  // copy actually looks like ("only 3 days left", "only two spots left").
  "only [^.!?]{0,24}\\bleft\\b",
  "don't wait",
  "running out",
];

// ---------------------------------------------------------------------------
// Governance (bounties, claims, evidence, evaluations, guardians, /me, /admin).
// Appended by the governance work package; strings only.
// ---------------------------------------------------------------------------

export const bountyStatusLabel: Record<string, string> = {
  drafted: "drafted — awaiting guardians",
  held_by_guard: "held by the guard",
  open: "open",
  claimed: "claimed",
  in_review: "in review",
  paid: "paid",
  deferred: "deferred — balance at follow-up",
  expired: "expired",
  withdrawn: "withdrawn",
};

export const tierLabel: Record<number, string> = {
  1: "tier 1 — the twin will show it",
  2: "tier 2 — photos with GPS and time",
  3: "tier 3 — an evaluator's word",
  4: "tier 4 — deposit now, balance on follow-up",
};

export const proposalsPage = {
  title: (name: string) => `${name}'s board`,
  intro: "Small, verifiable tasks I draft each week; my guardians approve them before anyone can claim. Every outcome is attested and public.",
  groups: {
    open: "Open — claim one",
    claimed: "Claimed — being worked on",
    in_review: "In review — evidence submitted",
    paid: "Paid",
    deferred: "Deferred — balance at follow-up",
    closed: "Closed",
  },
  emptyGroup: "none right now",
  humanProposals: "Proposals from people",
  humanProposalsEmpty: "No proposals from people yet. Anyone signed in can propose something below.",
  rankedBy: (rank: number) => `ranked #${rank} by me`,
  unranked: "not ranked yet",
  propose: "Propose something",
  proposeIntro: "Anyone may propose. I rank proposals against my strategy and say why; my stewards decide.",
  proposeTitle: "Title",
  proposeBody: "What should be done, and why it would help",
  proposeSubmit: "Send the proposal",
  proposeSignIn: "Sign in to propose something.",
  proposeThanks: "Thank you. Your proposal is on the board; I will rank it against my strategy and my stewards will decide.",
  view: "View",
  cap: (usdc: string) => `up to ${usdc} USDC`,
  deadline: (d: string) => `by ${d}`,
  evidence: "evidence",
} as const;

export const evidenceSpecCopy = {
  minPhotos: (n: number) => `${n} photo${n === 1 ? "" : "s"}`,
  exif: "original files with EXIF",
  gps: (m: number) => `GPS within ${m} m`,
  inApp: "captured in the app",
  anyCapture: "any camera",
  secondAbove: (usdc: number) => `second attestation above ${usdc} USDC`,
} as const;

export const bountyDetail = {
  why: "Why I'm asking",
  deliverable: "What to deliver",
  evidence: "What evidence is required",
  prediction: "What I predict",
  predictionLine: (place: string, property: string, direction: string, until: string) =>
    `${property} at ${place} should move ${direction} before ${until}. I will be scored on this.`,
  claims: "Claims",
  claimsEmpty: "Nobody has claimed this yet.",
  claim: "Claim this bounty",
  claimSignIn: "Sign in to claim this bounty.",
  claimed: "You claimed this. Capture your evidence below, then submit.",
  release: "Release my claim",
  claimedBy: (name: string, at: string) => `${name} claimed it ${at}`,
  released: "released",
  submissions: "Submissions",
  submissionsEmpty: "No evidence submitted yet.",
  submittedAt: (at: string) => `submitted ${at}`,
  summary: "Evidence summary (this is all I ever see)",
  specCheck: "Checked against the evidence spec",
  specOk: "meets the spec",
  specFail: "does not meet the spec",
  evaluation: "Evaluation",
  evaluationEmpty: "Not evaluated yet.",
  attestation: "Attestation",
  attestationPending: "signature pending (offchain EAS, signed by the evaluator's wallet in phase 2)",
  secondAttestation: "second attestation",
  secondNeeded: "A second evaluator's attestation is required above the threshold for this bounty.",
  evaluate: "Evaluate this submission",
  evaluateIntro: "You are an evaluator for this kami. You may not evaluate your own claim or a bounty you proposed. Your outcome becomes a signed attestation that follows the claimant.",
  outcome: "Outcome",
  outcomes: { succeeded: "succeeded", partial: "partial", failed: "failed", unverifiable: "unverifiable" } as Record<string, string>,
  notes: "Notes (public)",
  twinSnapshot: "Twin snapshot hash (optional)",
  submitEvaluation: "Record my evaluation",
  auditOf: "audit of an earlier evaluation",
  readyForPayout: "Ready for payout — the treasury will propose it to the guardians.",
  deferred: (due: string) => `Deferred: deposit now, balance after the follow-up due ${due}.`,
  spec: "Spec",
  specHash: "spec sha256",
  postedUid: "BountyPosted",
  approvedBy: (name: string, at: string) => `approved by ${name} ${at}`,
  notApproved: "not yet approved by a guardian",
  back: "Back to the board",
  withdrawn: "This bounty was withdrawn.",
  expired: "This bounty expired.",
  status: "Status",
} as const;

export const evidence = {
  heading: "Capture evidence",
  intro: "Take photos in the app so they carry time and location. Files are hashed on your phone before upload; the hash is what the attestation references.",
  choose: "Take a photo",
  chosen: (n: number) => `${n} file${n === 1 ? "" : "s"} ready`,
  note: "A short note for the evaluator (optional, 500 characters)",
  noteHint: "Links are removed. The kami only ever sees counts and this note, trimmed.",
  licenceTitle: "Evidence licence",
  licence: [
    "You confirm you took these photos yourself, at the place and time they show.",
    "You license them to the kami's steward organisation under CC BY 4.0 so they can appear in reports and on this page, credited to your display name.",
    "You may ask for a photo to be removed at any time. If a signed attestation references it, its hash stays on record and the file itself is deleted.",
    "Do not photograph people's faces, licence plates, or anything you don't have the right to share.",
  ],
  licenceAccept: "I accept the evidence licence",
  licenceRequired: "Please accept the evidence licence before uploading.",
  upload: "Upload",
  uploading: (done: number, total: number) => `Uploading ${done} of ${total}…`,
  finalize: "Submit for review",
  finalizing: "Checking files…",
  done: "Submitted. An evaluator will review it; you'll see the outcome here.",
  tooMany: (max: number) => `At most ${max} files per submission.`,
  tooLarge: (mb: number) => `Each file must be under ${mb} MB.`,
  failed: "The upload didn't finish. Nothing was submitted; try again.",
  hashing: "Hashing…",
  summaryFields: {
    photo_count: "photos",
    exif_ok_count: "with EXIF time",
    gps_within_spec_count: "within GPS spec",
    in_app_capture_count: "captured in app",
    captured_at_range: "captured between",
    note: "note",
  } as Record<string, string>,
} as const;

export const guardian = {
  title: "Guardian",
  intro: "Nothing moves without you. Approve or edit the drafts below, pause me if anything looks wrong, and invite the people who should hold this with you.",
  signIn: "Sign in to see the kami you guard.",
  noEntities: "You are not a guardian, evaluator, or steward of any kami yet. Invitations arrive by email.",
  drafts: "Bounty drafts to approve",
  draftsEmpty: "No drafts waiting.",
  heldByGuard: "held by the guard — a number in it did not match a reading; edit or withdraw",
  approve: "Approve",
  approveAndEdit: "Edit and approve",
  withdraw: "Withdraw",
  edit: {
    title: "Title",
    why: "Why",
    deliverable: "Deliverable",
    tier: "Verification tier",
    cap: "Cap (USDC)",
    claimLimit: "Claim limit",
    deadline: "Deadline",
    minPhotos: "Minimum photos",
    gpsWithin: "GPS within (m)",
    exifRequired: "EXIF required",
    inApp: "In-app capture required",
    secondAbove: "Second attestation above (USDC)",
    locked: "entity and twin places cannot be edited",
  },
  approvals: (n: number, required: number) => `${n} of ${required} approvals`,
  pause: "Pause",
  pauseHint: "One guardian can pause me: chat, cron, and proposals stop within a minute.",
  resume: "Request resume",
  resumeHint: "Two distinct guardians must request within 24 hours to wake me.",
  resumeRequests: (n: number) => (n === 1 ? "1 resume request in the last 24 h" : `${n} resume requests in the last 24 h`),
  retire: "Retire this kami",
  retireHint: "Two guardians. Pauses me for good, archives the page with its record, and asks the treasury to withdraw the Safe to the steward.",
  retireRequested: "Retirement requested — one more guardian is needed.",
  paused: "paused",
  live: "live",
  retired: "retired",
  invites: "Invite a guardian",
  inviteEmail: "Email",
  inviteSend: "Send invitation",
  inviteSent: "Invitation sent. It works for 7 days.",
  inviteLogged: "No mail key is set; the invitation link was written to the server log.",
  pendingInvites: "Pending invitations",
  twoNonFounder: "Two guardians besides the founder have accepted (G8).",
  notTwoNonFounder: "Fewer than two guardians besides the founder have accepted — the treasury stays closed until then (G8).",
  roles: "People with roles",
  revoke: "Revoke",
  safeProposals: "Safe proposals awaiting signatures",
  safeProposalsEmpty: "No pending Safe proposals.",
  safeProposalLink: "Review and sign",
  acceptTitle: "Accept your invitation",
  acceptIntro: "You were invited to guard a kami. Accepting records you as a guardian; a Safe key follows in phase 2.",
  acceptButton: "Accept",
  accepted: (name: string) => `You are now a guardian of ${name}.`,
  acceptSignIn: "Sign in with the invited email first, then open this link again.",
  mailSubject: (name: string) => `You're invited to guard ${name}`,
  mailBody: (name: string, url: string) =>
    `You've been invited to be a guardian of ${name}, an AI voice for a place on Kami.\n\nGuardians approve what it proposes and can pause it at any time. Nothing moves without you.\n\nAccept here (the link works for 7 days):\n${url}\n\nIf you didn't expect this, ignore this email.`,
  inviteRoleNote: "Evaluators and stewards are added by a steward directly; only guardians are invited by email.",
  grantRole: "Add a role by email",
  grantSend: "Add",
  granted: "Role added.",
} as const;

export const me = {
  title: "My account",
  beings: "My beings",
  beingsHint: "The beings you created or help care for.",
  beingsEmpty: "Your beings will appear here when you create one or accept a role.",
  visit: "Visit being",
  connectAgent: "Connect agent",
  private: "Private",
  paused: "Paused",
  retired: "Retired",
  summon: "Summon a being",
  drafts: "Continue summoning",
  draftUntitled: "Untitled being",
  resume: "Resume",
  draftStep: (step: number) => step === 6 ? "Ready for review" : `Step ${step} of 5`,
  signIn: "Sign in to see your claims, attestations and reputation.",
  profile: "Profile",
  email: "Email",
  wallet: "Wallet",
  walletNone: "No wallet yet — one is created when you first claim a bounty (phase 2).",
  passport: "Human Passport",
  passportNone: "not checked",
  claims: "My claims",
  claimsEmpty: "You haven't claimed a bounty yet.",
  attestations: "My attestations",
  attestationsEmpty: "No attestations yet. Each evaluated submission produces one you can show anyone.",
  reputation: "My reputation",
  reputationNone: "No reputation run includes you yet.",
  reputationNew: "new",
  reputationUnverified: "unverified — Passport score below the threshold; computed but not published",
  reputationNote: "Reputation is a public function over signed attestations; anyone can recompute it from the UIDs listed in the nightly file.",
  export: "Export my data (JSON)",
  data: "Data controls",
  deleteChats: "Delete my chat sessions",
  deleteChatsDone: (n: number) => `${n} chat session${n === 1 ? "" : "s"} deleted.`,
  contributeOptIn: "Let my future chats be used to improve the model",
  contributeNote: "Off by default. Chats are deleted after 90 days unless you opt in.",
  evidenceDeletion: "Ask to remove my evidence files",
  evidenceDeletionNote: "Files are deleted; where an attestation references one, its hash stays on record.",
  evidenceDeletionDone: (n: number) => `Deletion requested for ${n} file${n === 1 ? "" : "s"}.`,
  saved: "Saved.",
} as const;

export const admin = {
  title: "Admin",
  intro: "Platform operators only. Nothing here is public.",
  entities: "Entities",
  cols: { name: "kami", flags: "flags", guardDrop: "guard drop %", pulseSkip: "pulse skip %", consultation: "consultation", tokens7d: "model usage / 7 d" },
  paused: "paused",
  retired: "retired",
  consultationDone: "done",
  consultationPending: "pending",
  toggleConsultation: "Toggle consultation done",
  usage: "Model usage per day (last 14 days)",
  usageUnit:
    "Usage is counted in language-model units — the words the model read and wrote. No token, ever: nothing here is a crypto token and nothing has a price.",
  usageEmpty: "No usage recorded.",
  tunnel: "GPU tunnel",
  tunnelSeen: (iso: string) => `last seen ${iso}`,
  tunnelNever: "never seen",
  tunnelDown: "down — pages render asleep",
  sb243: "SB 243 annual report due",
  sb243Save: "Save date",
  cost: "Cost estimate",
  costLine: (units: number, usd: string) => `${units.toLocaleString()} model units in 7 days ≈ ${usd} USD at config.card_hour_cost`,
  costNoRate: "set config.card_hour_cost (USD per card-hour) to estimate",
  notMeasured: "—",
  chainHead: "audit chain",
} as const;

export const govErrors: Record<string, string> = {
  not_found: "That bounty or record doesn't exist.",
  forbidden: "You don't have that role for this kami.",
  unauthenticated: "Please sign in first.",
  paused: "This kami is paused; nothing can be claimed or approved until two guardians wake it.",
  retired: "This kami is retired.",
  invalid_transition: "That change isn't allowed from the bounty's current state.",
  claim_limit: "This bounty has already been claimed by as many people as it allows.",
  already_claimed: "You already claimed this bounty.",
  monthly_cap: "This claim would take you over the monthly cap across all kami. Finish or release a claim first.",
  passport_required: "Bounties above the threshold need a Human Passport score above the minimum. Verify your Passport, then try again.",
  self_evaluation: "You can't evaluate your own claim.",
  proposer_evaluation: "You can't evaluate a bounty you proposed.",
  second_attestation_required: "A second, independent evaluator must also attest before this can be paid.",
  already_evaluated: "This submission already has an evaluation; a second evaluator may add theirs.",
  immutable_field: "Guardians may edit any field except the entity and its twin places.",
  invalid_spec: "The bounty spec is incomplete or invalid.",
  tier1_prediction_required: "A tier-1 bounty must name a prediction: place, property, direction, and window.",
  comment_window_open: "The public comment window is still open; ratify after it closes.",
  invite_invalid: "That invitation isn't valid.",
  invite_expired: "That invitation has expired. Ask the guardian to send a new one.",
  invite_email_mismatch: "This invitation was sent to a different email. Sign in with the invited address.",
  already_requested: "You already requested this; a second guardian is needed.",
  not_paused: "This kami isn't paused.",
  licence_required: "Please accept the evidence licence before uploading.",
  too_many_files: "At most 30 files per submission.",
  file_too_large: "Each file must be under 50 MB.",
  sha_mismatch: "A file changed between hashing and upload. Please try again.",
  no_files: "Upload at least one file before submitting.",
  no_claim: "You don't hold an active claim on this bounty.",
  no_db: "The database is not configured.",
  no_submission: "No evidence has been submitted for this claim yet.",
  hat_required: "Your role carries a Hat that could not be verified on chain.",
  generic: "Something went wrong on our side.",
};

/**
 * The connect on-ramp — `/e/[slug]/connect` (PRD §4.5, §5 J1; architecture
 * §6.2). Written for someone who is technically fluent and has never seen this
 * system: each block says what a thing *is* before it says what to do with it,
 * and names what breaks when it is got wrong.
 *
 * Two things this copy may never imply. First, that the platform can see or
 * control the agent: it cannot: it can see only what an agent does when it
 * calls a tool, which is why every status line is worded as arrival, not as
 * health. Second, that a token can be recovered: the platform stores a hash, so
 * a token that is not copied is gone, and the honest instruction is to mint
 * another one.
 */
export const connect = {
  link: "Connect an agent",
  linkHint: "Agent setup for this being’s team.",
  /** The step after summoning: a kami exists, and nothing is speaking for it yet. */
  nextStep: "Connect your agent",
  nextStepHint:
    "Give your being a voice. Connect Hermes, Claude Code, or another MCP client using its credentials and care instructions.",
  title: (name: string) => `Connect an agent to ${name}`,
  intro:
    "Connect your agent to this being’s tools, ecological observations, and care instructions. Create a credential, choose your client, then check for its first activity.",
  cannotSee:
    "Your agent runs on your own machine or server. Website chat requires a separate gateway connection.",
  roleSteward: "Your access: steward.",
  roleCreator: "Your access: creator.",
  roleAdmin: "Your access: administrator.",
  roleGuardian:
    "Your access: guardian. You can review setup; a steward or creator manages credentials.",
  noDb: "The database is not configured, so this page cannot show a bearer token, a bundle, or a status.",
  paused: "This being is paused. Its tools still list, but the gate refuses model traffic for it until two guardians wake it.",

  tabs: {
    label: "Connection path",
    any: "Any MCP client",
    anyHint: "Use the downloaded configuration with Claude Code or another MCP client.",
    hermes: "Hermes",
    hermesHint: "A dedicated profile with care instructions and scheduled work.",
  },

  // --- 1. what do I point my agent at? -------------------------------------
  endpoint: {
    heading: "1 · Connect your client",
    what:
      "This credential grants access only to this being. The configuration also connects to the public Front Range Twin for ecological data.",
    endpointLabel: "MCP endpoint",
    slugLabel: "Entity slug",
    transport: "Transport: Streamable HTTP, stateless. No session id, JSON responses. Send your token as an Authorization header on every request.",
    headerLabel: "Authorization header",
    rate: "Limit: 600 requests per hour per token. Respect Retry-After when rate limited.",
  },

  claude: {
    heading: "Claude Code",
    what: "Extract the bundle into a dedicated working folder. Set PLATFORM_MCP_TOKEN securely in your shell environment, then start Claude Code from that folder:",
    command: "claude --mcp-config ./mcp.json",
    verify: "Use /mcp to check both connections. Ask Claude to read SOUL.md and the entity-steward skill, then retrieve this being’s configuration and current twin observations before drafting any action.",
  },

  // --- the token -----------------------------------------------------------
  token: {
    heading: "Agent credential",
    what:
      "This secret lets your agent read and write on behalf of this being. Only its hash is stored; save the value securely when it appears.",
    noneYet: "No bearer token has been minted for this being yet. Nothing can connect until one is.",
    mint: "Mint a bearer token",
    mintConsequence: "It is shown once, on this page, and then never again. Copy it into your agent's environment before you leave.",
    existsHeading: "A bearer token exists",
    mintedAt: (iso: string) => `Minted ${iso}.`,
    age: (duration: string) => `${duration} old.`,
    prefixLabel: "Prefix",
    fingerprintLabel: "Fingerprint",
    fingerprintWhat: "A reference for identifying the credential; not a secret.",
    wasRotated: "This token replaced an earlier one.",
    shownOnceHeading: "Copy this now",
    shownOnce:
      "This is the only time this token will ever be displayed. It is not stored anywhere you can read it back. If you lose it, mint another one — which invalidates this one.",
    copied: "Copied",
    copy: "Copy",
    hide: "I have copied it — hide",
    hiddenAgain: "It is no longer on screen. Mint another one if you did not copy it.",
    rotate: "Rotate this token",
    rotateWarningHeading: "Rotating breaks the running agent",
    rotateWarning:
      "Minting again overwrites the stored hash. The one your agent is using now stops working on the next request — it will start getting 401s, and its pulses and drafts will stop arriving, until you put the new value in its environment and restart it.",
    rotateConfirm: "I understand this stops the agent that is running now",
    rotateGo: "Rotate anyway",
    rotateCancel: "Cancel",
    rotated: "Rotated. The previous token no longer works.",
    minted: "Minted.",
    cannotMint: "Minting and rotating are done by the steward or the creator of this being.",
    envHint: (tokenVar: string, slugVar: string, slug: string) =>
      `Your agent reads it from its environment as ${tokenVar}, alongside ${slugVar}=${slug}. Keep it out of version control; it is a credential for this entity's write tools.`,
  },

  // --- 2. what can my agent do? --------------------------------------------
  tools: {
    heading: "2 · Explore the tools",
    what:
      "The platform handles care and collaboration. The twin provides read-only ecological observations.",
    platformHeading: "The platform MCP — nine tools",
    platformWhat:
      "Scoped to this entity by your token. It is how the agent learns what the platform has computed (needs, mood, caps, guardians) and how anything it writes reaches the page.",
    twinHeading: (n: number) => `The twin MCP — ${n} tools`,
    twinWhat:
      "The public Front Range Bioregional Twin runs at https://mcp.bioregionaltwin.org/mcp. Connect over Streamable HTTP; no API key or local package is required.",
    twinPackage: (pkg: string) => `Run it with npx ${pkg}; point it at the tree and at binding.json from the bundle.`,
    read: "reads",
    write: "changes something",
    readWhat: "Returns data. Calling it twice changes nothing.",
    writeWhat: "Writes to the platform: it appears on the page and in this being's audit log.",
    noneListed: "The tool registry could not be read, so nothing is listed. That is a fault on this page, not a statement about the servers.",
    factRule:
      "One rule cuts across all of them: every number the agent says has to have come back from a tool result in the same turn. The guard in front of the model drops sentences that carry numbers it cannot match, so a well-behaved agent calls a tool before it speaks.",
    hermesIncluded: (n: number, total: number) => `The Hermes profile this project deploys includes ${n} of these ${total}.`,
    includedLabel: "in the Hermes profile",
  },

  // --- 3. what is the brain supposed to be? --------------------------------
  soul: {
    heading: "3 · Give it a voice",
    what:
      "SOUL.md combines shared care rules with this being’s own voice. Load it into your agent’s instructions before beginning work.",
    hardRulesHeading: (version: number) => `Hard rules, version ${version} — locked`,
    hardRulesWhat: "Rendered read-only. There is no code path in this app that writes them, and the gate enforces the parts of them a machine can check.",
    voiceHeading: (version: number) => `Voice block, soul v${version}`,
    voiceMissing: "This being has no soul row yet, so there is nothing to render and no bundle to build.",
    ifYouChange:
      "If you edit the hard rules in your copy, you are running something else. Say so plainly; do not present it as this being.",
  },

  bundle: {
    heading: "The bundle",
    what:
      "Download the configuration, care instructions, skills, and ecological binding for this being.",
    contains: "What is in it",
    download: "Download the bundle (.zip)",
    downloadHint: (filename: string) => `${filename} — a few tens of kilobytes of text.`,
    view: "Show the files instead",
    noToken:
      "Credentials are excluded. Set PLATFORM_MCP_TOKEN in your client’s environment before connecting.",
    provenance: (binding: number | null, review: string, soulV: number, rules: number) =>
      `Rendered from binding v${binding ?? "—"} (${review}), soul v${soulV}, hard rules v${rules}.`,
    bindingPending:
      "This binding has not been approved by a steward yet. The bundle renders anyway, but the hourly job does not compute a snapshot until it is, so the agent's needs calls will find nothing.",
    unavailable: "The bundle cannot be built yet.",
  },

  // --- 4. is it working? ---------------------------------------------------
  status: {
    heading: "4 · Connection activity",
    what:
      "Recent activity recorded by the platform. A successful MCP connection and a working website chat are separate signals.",
    refreshing: "Checking every few seconds.",
    refreshFailed: "The status check did not answer. Retrying; last known activity remains below.",
    lastChecked: (iso: string) => `Last checked ${iso}.`,
    stateWaiting: "waiting",
    stateSeen: "seen",
    stateNotConfigured: "not set up",
    seenAt: (iso: string, ago: string) => `${iso} · ${ago} ago`,
    signals: {
      token: {
        label: "A bearer token exists",
        waiting: "No token has been minted.",
        notConfigured: "Mint one above. Nothing else on this list can happen first.",
        seen: "Minted. This says nothing about whether anything has used it.",
      },
      mcp_call: {
        label: "That token has been used",
        waiting: "It exists and no request has arrived with it yet. Start your agent, or call tools/list by hand to prove the path.",
        notConfigured: "Nothing has been minted yet, so there is nothing to have been used.",
        seen: "A request authenticated with this token arrived. This is the moment the connection is real.",
        note: "Recorded by the rate limiter, which runs on every authenticated request — reads included. It does not record which tool was called.",
      },
      mcp_tool: {
        label: "A tool changed something",
        waiting: "Nothing has been written yet. Read-only calls never appear here, so an agent can be perfectly healthy and this line can stay empty for hours.",
        notConfigured: "Nothing has been minted yet.",
        seen: "The most recent write reaching the platform.",
        tool: (name: string) => `via ${name}`,
      },
      pulse: {
        label: "A pulse has been posted",
        waiting: "No pulse yet. A pulse is the agent's hourly heartbeat: it looks, and speaks only if something changed. Nothing changing is the common and correct outcome, so silence here is not a fault — but a first pulse is how you know the loop runs.",
        notConfigured: "No pulse yet.",
        seen: "The last pulse stored.",
        spoke: "it wrote something",
        silent: "it looked and stayed quiet",
      },
      gate: {
        label: "The gate is reporting",
        waiting: "A profile on disk names a model, but the gate itself has not reported. That names a request for a model, not a measurement of one.",
        notConfigured: "Nothing has reported where the model runs. Until something does, the public page says it does not know, rather than guessing.",
        seen: "The proxy in front of the model reported where it runs.",
        note: "This is about the model serving chat, not about your agent. An agent can be connected while this stays empty.",
      },
      chat: {
        label: "The chat path is configured",
        waiting: "A gateway is configured and the box has not said hello yet.",
        notConfigured: "Website chat is not connected to a live gateway. Configure HERMES_GATEWAY_URL and verify a gateway heartbeat to enable it.",
        seen: "The box's last heartbeat.",
      },
    } as Record<string, { label: string; waiting: string; notConfigured: string; seen: string; note?: string; tool?: (name: string) => string; spoke?: string; silent?: string }>,
  },

  // --- the Hermes worked example -------------------------------------------
  hermes: {
    heading: "Hermes — one worked example",
    what:
      "Use a dedicated Hermes profile for this being. It includes MCP connections, care instructions, and recurring jobs.",
    configHeading: "config.yaml",
    configWhat:
      "Rendered from profiles/templates/config.yaml.tmpl for this entity. The model base URL points at the gate, never at vLLM directly — the gate is what enforces budgets, the pause set and the fact guard.",
    envHeading: ".env",
    envWhat: "Two variables, written with mode 600 next to the profile. No chain key may ever live in a profile directory: the agent never signs.",
    cronHeading: "The five cron jobs",
    cronWhat: "Rendered from profiles/templates/cron.yaml into one hermes cron add call each. Times are America/Denver.",
    commandsHeading: "Advanced host setup",
    commandsWhat: "From docs/deploy/first-entity.md, checkpoint 2. Run them from the repository root on the machine that will host the agent.",
    commands: (slug: string) => [
      `export PLATFORM_MCP_TOKEN=…        # the value shown once above`,
      `pnpm --filter @kami/profile-scripts run deploy-profile ${slug} --dry-run`,
      `pnpm --filter @kami/profile-scripts run deploy-profile ${slug} --host localhost`,
      `bash infra/mac/install.sh --only hermes`,
      `bash scripts/kami-doctor --only hermes`,
      `hermes cron run pulse --profile ${slug}     # the first pulse`,
    ],
    jobsLabel: "job",
    scheduleLabel: "schedule",
    unverified:
      "These host automation commands require verification against your installed Hermes version. Review docs/deploy/first-entity.md before running them.",
    provisionNote:
      "The platform can also render and push this profile for you: POST /api/admin/profiles with this slug. That path mints its own, which rotates the one on this page.",
  },

  errors: {
    forbidden: "You do not hold a role on this being.",
    not_found: "There is no kami at that address.",
    no_db: "The database is not configured.",
    no_binding: "This being has no approved binding row yet, so there is nothing to bind an agent to.",
    no_soul: "This being has no soul row yet.",
    confirm_required: "Rotating needs the confirmation box ticked first.",
    generic: "Something went wrong on our side. Nothing was changed.",
  } as Record<string, string>,
} as const;
