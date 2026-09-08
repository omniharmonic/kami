/**
 * Summon copy (PRD §6.2, §4.4, §4.5, §13; plan T3.1).
 *
 * CLAUDE.md puts copy in one `copy/` module per app. `src/copy/index.ts` is
 * shared with two other work packages in flight, so these strings live here
 * for now and are meant to be moved verbatim into `src/copy/index.ts` as
 * `export const summon = …` once the branches merge (see the work-package
 * report). Nothing here is generated; every string is written, English only.
 */

export const STEP_TITLES: Record<number, string> = {
  1: "Choose the place",
  2: "Pick the archetype and parts",
  3: "Read the hard rules, write the voice",
  4: "Name two guardians",
  5: "Fund it (optional)",
  6: "Review",
};

export const summon = {
  title: "Summon a kami",
  intro:
    "A kami is an AI voice for one place, built on the Front Range Bioregional Twin's public readings. Five steps. Everything saves when you submit, so you can close the tab and come back.",
  start: "Start",
  resume: "Resume where you left off",
  drafts: "Your drafts",
  draftLine: (step: number, at: string) => `Step ${step} of 5 — last saved ${at}`,
  stepOf: (n: number) => `Step ${n} of 5`,
  next: "Save and continue",
  back: "Back",
  soFar: "Your kami so far",
  soFarEmpty: "Nothing chosen yet.",
  notSignedIn: "Sign in first — a kami needs a steward with an email address.",
  notYours: "That draft belongs to someone else.",
  noDb: "The database is unreachable, so a draft cannot be saved right now. Nothing was lost; try again in a minute.",

  // --- step 1 -------------------------------------------------------------
  place: {
    selected: (name: string) => `${name} is selected.`,
    selectedHelp: "Your place proposal is saved. Review its sensing below, or continue to shape your being.",
    continueAppearance: "Continue to appearance →",
    title: STEP_TITLES[1]!,
    intro:
      "Search the twin's identity registry by name. Watersheds, gauges, reservoirs and monitoring sites are all here. Pick the place your kami will speak for.",
    searchLabel: "Search places",
    searchPlaceholder: "Left Hand Creek",
    kindLabel: "Kind",
    kindAny: "any kind",
    hucLabel: "HUC prefix",
    hucHelp: "2–12 digits, e.g. 1019 for the South Platte headwaters.",
    searching: "Searching the twin…",
    noResults: "Nothing in the registry matches that. The twin publishes what it has; a place with no published id cannot be bound.",
    more: (n: number) => `${n} more matches — narrow the search or load the next page.`,
    loadMore: "Load more",
    unreachable: "The twin is not answering right now, so I can't search it. Nothing is lost — try again in a minute.",
    choose: "Choose this place",
    proposing: "Working out what this kami could sense…",
    proposalHeading: "What the platform proposes",
    provenance:
      "This membership list is the platform's guess, not a fact. A steward reviews and approves it before the kami goes live; until then the binding sits in review.",
    membersHeading: (n: number) => `${n} twin places`,
    watershedsHeading: (n: number) => `${n} watersheds`,
    anchor: "Anchor (the place whose headline need leads the page)",
    senseHeading: "What it could sense today",
    senseIntro:
      "One row per need, from readings published today. Absent means unknown, never zero. Gaps are named here rather than papered over.",
    gapsHeading: "Named gaps",
    validationErrors: "The proposed binding does not validate against the twin. This is a platform bug, not your mistake — nothing was saved.",
    validationWarnings: "Warnings a steward will look at:",
    archetypeLabel: "Archetype",
    nameLabel: "Name",
    nameHelp: "What people will call this kami. The slug is derived from it.",
    slugLabel: "Address",
    gnisLabel: "Stream GNIS id (optional)",
    gnisHelp: "If you know it, gauges on this stream outside the watershed set are picked up too.",
  },

  sensing: {
    live: "reading published today",
    stale: "last reading is old",
    missing: "nothing published today",
    noPercentile: (need: string) => `no percentile is published for ${need} yet, so it can't say whether today is low or high for the season`,
    noPlaces: (need: string) => `${need} comes from a live map layer, not from a station`,
    header: { need: "Need", property: "Property", where: "Where", state: "State", note: "What that means" },
  },

  // --- siblings -----------------------------------------------------------
  siblings: {
    heading: "Other kami already speak for this place",
    plurality: (place: string) => `${place} has more than one voice. None of them speaks for it alone.`,
    intro:
      "These kami are bound to the same anchor place. Yours would be a sibling, not a replacement: different steward, different guardians, different soul, different treasury, the same readings.",
    steward: "Steward",
    guardians: "Guardians",
    noGuardians: "no guardians accepted yet",
    visit: "Visit",
    continueAnyway: "Continue — mine will be a sibling",
    empty: "No other kami is bound to this place yet.",
  },

  // --- step 2 -------------------------------------------------------------
  parts: {
    title: STEP_TITLES[2]!,
    intro:
      "Cosmetics are the only thing anyone ever chooses. They are earned by human action — a bounty completed, a drill run, a season tended — never by data. A reading never unlocks a hat, and a hat never changes a reading.",
    rigPending:
      "The rigs are commissioned but not delivered yet, so the preview is the static SVG fallback. Your choices are stored now and bind to the rig when it lands.",
    archetype: "Archetype",
    colour: "Colour",
    parts: "Parts",
    locked: "Earned by human action — not yet unlocked",
    preview: "Preview",
  },

  // --- step 3 -------------------------------------------------------------
  soul: {
    title: STEP_TITLES[3]!,
    hardRulesHeading: "The hard rules (locked)",
    hardRulesIntro:
      "These come first and cannot be edited — not by you, not by a steward, not by the kami. They are rendered here from the platform's template so you can read exactly what your kami is bound by.",
    hardRulesReadOnly: "Read-only. The client never sends this block back; the server renders it from the template.",
    voiceHeading: "The voice block",
    voiceIntro:
      "Three sentences at most, about how this kami sounds and what it pays attention to. Not facts — it may not state a number that did not come from a tool call this turn.",
    voiceLabel: "Voice (max 3 sentences)",
    examplesHeading: "Three worked examples",
    examples: [
      {
        label: "A creek with a long gauge record",
        text: "You speak for Boulder Creek from the canyon mouth at Orodell down through town toward the Saint Vrain, in a plain, curious Front Range voice that would rather ask what a reading means than dress it up. You call things by their local names — Orodell, Broadway, the forebay, Gross, Niwot. You never claim to be the creek, only an AI voice for it, built on public sensor data.",
      },
      {
        label: "A reservoir that is mostly administered",
        text: "You speak for Gross Reservoir as a working piece of infrastructure that also happens to be a place people love. You are frank that storage is a management decision as much as a season, and that you can only see what the operators publish. You would rather say \"I don't have a reading for that\" than round from memory.",
      },
      {
        label: "A ridge with almost no sensors",
        text: "You speak for the Niwot ridge in short, dry sentences, mostly about snow. You have one SNOTEL and a lot of silence, and you say so instead of filling the gap. When the snow pillow goes quiet you sleep rather than guess.",
      },
    ],
    useExample: "Use this as a starting point",
    previewHeading: "Preview chat",
    previewIntro:
      "This runs against a staging profile through the same gate as production: the same guard, the same budget, the same refusals. It is a preview, not your kami — nothing said here is kept.",
    previewLabel: "Ask the preview something",
    previewSend: "Send",
    previewBadge: "Preview — staging profile",
    previewUnavailable:
      "The gateway is not answering, so there is no preview right now. It is not saying anything; the thinking machine is off. Your voice block still saves.",
    previewPaused: "The staging profile is paused, so the preview is refused. That is the pause switch working.",
    previewBudget: "The staging profile has used its budget for today, so the preview is refused. Back tomorrow.",
    previewNoSoul: "Write a voice block first, then the preview has something to be.",
    errors: {
      empty: "The voice block is empty. Three sentences at most, but at least one.",
      tooLong: (n: number, max: number) => `That is ${n} sentences; the limit is ${max} (PRD §4.5).`,
      fence: (marker: string) => `The voice block may not contain the fence marker '${marker}'.`,
      hardRules: "The hard-rules block is rendered by the server and cannot be sent from the client.",
    },
  },

  // --- step 4 -------------------------------------------------------------
  guardians: {
    title: STEP_TITLES[4]!,
    intro:
      "Two guardians besides you. They are not decoration: nothing moves without two of them, and either can pause this kami.",
    roles: [
      { name: "Steward (you)", one: "Writes and edits the voice block, marks the consultation record, and answers for this kami in public." },
      { name: "Guardian", one: "Holds the money with the other guardians, approves or edits every bounty draft, and can pause or retire this kami on their own." },
      { name: "Evaluator", one: "Reviews evidence for a completed bounty and signs the outcome attestation; never the person who did the work." },
    ],
    emailLabel: (n: number) => `Guardian ${n} email`,
    emailHelp: "They get a link. Accepting takes one tap and an email address; no wallet, no seed phrase.",
    sameAsYou: "A guardian must be someone other than you.",
    duplicate: "Those two addresses are the same.",
    invalidEmail: "That does not look like an email address.",
    liveOn: "Your kami goes live read-only — avatar, meters, chat, no treasury — as soon as both guardians accept.",
    safeConfigured: "On the second acceptance the platform deploys a 2-of-3 Safe with you and the two guardians as owners.",
    safePending:
      "Safe deployment is not configured on this deployment, so it is recorded as pending. Until a chain operator runs it there is no treasury, and the page says so.",
    pending: (email: string) => `${email} — invited, waiting`,
    accepted: (email: string) => `${email} — accepted`,
  },

  // --- step 5 -------------------------------------------------------------
  fund: {
    title: STEP_TITLES[5]!,
    intro: "Optional, and you can skip it entirely. A kami with no money still senses, still speaks, and still keeps its record.",
    cannot: "What the money cannot do",
    cannotList: [
      "The kami cannot move it. It may draft a bounty; two human guardians sign, or nothing happens.",
      "It cannot buy the place, protect it legally, or give the kami standing anywhere.",
      "It cannot buy cosmetics, a better mood, or a louder voice. Nothing on this platform is for sale.",
      "There is no token, no points, and no price for this place — not now, not later.",
    ],
    can: "What it can do",
    canList: [
      "Pay people for verifiable work in the watershed, in tiers, with photographs and an attestation anyone can check.",
      "Cover the cost of running this kami: a rented GPU hour, a domain, an email.",
    ],
    fees: "Card gifts are charged 2.9% + 30¢ by the processor before anything reaches the treasury. Every donor gets the monthly report with tx hashes.",
    donateLink: "Open the donate page",
    donateLater: "The donate page opens once your kami exists. You can always come back to it.",
    skip: "Skip — no money for now",
  },

  // --- review / consultation ---------------------------------------------
  review: {
    title: STEP_TITLES[6]!,
    intro: "Everything below is what will be created. Nothing is written until you confirm.",
    confirm: "Summon this kami",
    consultationHeading: "Community relationships (optional)",
    consultationIntro:
      "The Front Range is Arapaho, Cheyenne, and Ute country, and also Comanche, Kiowa, and Plains Apache. We encourage building relationships with relevant Tribal offices and local communities as a being grows. Consultation is optional and never blocks publication. The being never speaks for nations.",
    consultationLabel: "Consultation record — who you have contacted, when, and what was said",
    consultationHelp: "Leave this blank or record the conversations you have had. You can update it as relationships grow. This record is independent of publication.",
    consultationPending:
      "This being is in private preview. Its steward can publish it independently of the optional consultation record.",
    consultationDone: (iso: string) => `Consultation recorded ${iso}.`,
    markDone: "Record completed consultation",
    publish: "Publish this being",
    published: "This being’s page is published.",
    created: "Summoned",
    createdBody: (name: string) => `${name} exists. Review its binding and connect its agent, then publish its page when ready. Community consultation is encouraged as it grows.`,
    goToEntity: "See the page",
    bindingPending: "The binding is in review. Until a steward approves it, the hourly job does not compute a snapshot and the meters stay empty.",
    incomplete: (step: number) => `Step ${step} is not finished yet.`,
    alreadyDone: "This draft has already been summoned.",
  },

  errors: {
    slug_taken: "A kami already lives at that address. Pick another name.",
    draft_not_found: "There is no draft by that id for you.",
    step_incomplete: "An earlier step is not finished.",
    already_completed: "This draft has already been summoned.",
    twin_unreachable: "The twin is not answering, so the place search can't run. Nothing was lost.",
    binding_invalid: "The proposed binding does not validate against the twin.",
    voice_invalid: "The voice block was refused.",
    hard_rules_immutable: "The hard-rules block cannot be edited or sent from the client.",
    guardians_invalid: "Two guardian addresses are needed, both different from yours.",
    generic: "Something went wrong on our side. Nothing was lost.",
  } as Record<string, string>,
} as const;

export type SummonCopy = typeof summon;
