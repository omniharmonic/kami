/**
 * Strings for `/me/wallet`. Belongs in `src/copy/index.ts`; that file is
 * another package's, so they live here for the orchestrator to merge.
 */
export const walletCopy = {
  title: "Your wallet",
  intro:
    "Bounty payments arrive as USDC on Base. A wallet is made for you the first time you need one — claiming a bounty, accepting guardianship, or opening this page — and not before.",
  signIn: "Sign in to see your wallet.",
  notConfigured: "Wallets are not switched on for this deployment yet. Nothing is missing from your account; there is simply nowhere to put a wallet.",
  address: "Address",
  addressNone: "You have no wallet yet.",
  network: "Network",
  create: "Create my wallet",
  creating: "Creating…",
  createNote: "This makes an embedded wallet held by our wallet provider and keyed to your account. It costs nothing and moves nothing.",
  createFailed: "The wallet could not be created just now. Nothing was changed.",
  linked: "Wallet linked.",

  keys: {
    heading: "Whose keys these are",
    body: [
      "The key is yours, not ours. Kami never holds it, never asks for it, and has no code path that could receive it.",
      "You can export it from the wallet provider at any time and move the money anywhere you like. Exporting does not close your Kami account.",
      "Disconnecting here forgets the link between your account and the wallet. The wallet and its money stay exactly where they are.",
    ],
    export: "Export your key",
    exportNote: "Export happens in the wallet provider's own screen, not ours.",
    disconnect: "Disconnect this wallet",
    disconnectNote: "We forget the address. Nothing on chain changes.",
    disconnected: "Wallet disconnected. Nothing on chain changed.",
  },

  offramp: {
    heading: "Turning USDC into money in a bank",
    body: "The off-ramp is a third party's, not ours: you go to them, they know you, and we never see the transaction.",
    link: "Open the off-ramp",
    none: "No off-ramp link is configured yet. USDC on Base can be moved to any exchange or wallet you already use.",
    verify: "Availability in your country is the off-ramp provider's business, not ours.",
  },

  tax: {
    heading: "Tax forms",
    body: (cumulative: string, threshold: string) =>
      `You have been paid $${cumulative} this tax year. At $${threshold} we ask for a W-9 (or a W-8 if you are outside the US) before the next payment.`,
    collected: "We have your form on file.",
    sponsor: "A fiscal sponsor pays and handles the forms for this platform, so we do not ask you for one.",
    notAdvice: "This is a description of our process, not tax advice.",
  },
} as const;
