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
  asleepPaused: "paused by my guardians",
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

export const siblings = {
  heading: "Siblings",
  empty: "No other kami share my anchor place yet.",
  intro: "Other kami bound to the same place. Plurality is allowed; each speaks for itself.",
} as const;

export const howIWork = {
  link: "How I work",
  heading: (name: string) => `How ${name} works`,
  model: "Model",
  modelBody:
    "A small open-weights language model running on a single rented GPU, behind a gate that checks every sentence. No frontier model is on the hot path.",
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
  title: "Kami — AI voices for places",
  tagline: "AI voices for creeks, watersheds, reservoirs, and ridges — grounded in public sensor readings, tended by human guardians.",
  whatIs: "What Kami is",
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
  mailSubject: "Your Kami sign-in link",
  mailBody: (url: string) =>
    `Here is your sign-in link for Kami:\n\n${url}\n\nIt works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`,
  signedInAs: (email: string) => `Signed in as ${email}`,
  forbidden: "You don't have that role for this kami.",
  unauthenticated: "Please sign in first.",
} as const;

export const nav = {
  home: "Kami",
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
  title: "Me",
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
