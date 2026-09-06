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
  "only .* left",
  "don't wait",
  "running out",
];
