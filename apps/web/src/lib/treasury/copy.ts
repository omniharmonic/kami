/**
 * Strings for the treasury screens and mails. CLAUDE.md wants one copy module
 * per app (`src/copy/index.ts`); that file belongs to another work package, so
 * these live here for now and should be merged there by the orchestrator
 * (noted in the WP10 report). English only; no urgency language.
 */
export const treasuryCopy = {
  page: {
    title: "Sign a payout",
    eyebrow: "Guardian approval",
    intro: (name: string) => `An AI voice for ${name} proposed this payout. Two guardians must sign before any money moves; you are signing a Safe transaction hash, nothing else.`,
    bounty: "Bounty",
    evidence: "Evidence",
    evidenceNone: "No evidence files were attached to this submission.",
    evaluation: "Evaluation",
    evaluationNotes: "evaluator notes",
    attestation: "ProposalOutcome attestation",
    amount: "Amount",
    recipient: "Recipient",
    safe: "Safe",
    nonce: "nonce",
    proposedAt: "proposed",
    confirmations: (n: number, required: number) => `${n} of ${required} signatures`,
    status: { pending: "awaiting signatures", executed: "executed", rejected: "rejected", expired: "expired" } as Record<string, string>,
    signInSafe: "Sign in Safe{Wallet} instead",
    notFound: "There's no proposal by that hash.",
    forbidden: "Only this kami's guardians can open a payout for signing.",
    signIn: "Sign in to continue.",
    alreadyDone: "This proposal is no longer waiting for signatures.",
  },
  sign: {
    button: "Sign this payout",
    signing: "Waiting for your wallet…",
    submitting: "Recording your signature…",
    done: (n: number, required: number) => (n >= required ? "Signed. The relayer will execute it within a minute." : `Signed. ${required - n} more guardian signature${required - n === 1 ? "" : "s"} needed.`),
    noWallet: "No wallet found in this browser. Use the Safe{Wallet} link below, or sign in with your Privy wallet.",
    rejected: "Your wallet declined to sign. Nothing was recorded.",
    failed: "The signature could not be recorded. Please try again or use Safe{Wallet}.",
    what: "What you are signing",
    whatBody: "An EIP-712 SafeTx hash: USDC.transfer(recipient, amount) from this Safe at this nonce. Your wallet shows the same fields.",
  },
  mail: {
    proposedSubject: (name: string, amount: string) => `${name}: a ${amount} USDC payout needs your signature`,
    proposedBody: (name: string, amount: string, recipient: string, title: string, url: string) =>
      `An AI voice for ${name} proposed paying ${amount} USDC to ${recipient} for "${title}".\n\nReview the evidence and sign (two guardians are needed):\n${url}\n\nYou can also sign the same transaction in Safe{Wallet}. Nothing moves until two of you have signed.`,
    paidSubject: (name: string, amount: string) => `${name} paid you ${amount} USDC`,
    paidBody: (name: string, amount: string, title: string, txHash: string, uid: string) =>
      `Your work on "${title}" for ${name} was paid: ${amount} USDC.\n\nTransaction: ${txHash}\nAttestation (BountyCompleted): ${uid}\n\nThank you.`,
    reconcileSubject: (name: string) => `${name}: nightly reconciliation found a mismatch`,
    reconcileBody: (name: string, findings: string) => `The nightly reconciliation for ${name} did not come out clean. The donor report is blocked until this is resolved.\n\n${findings}`,
    relayerLowSubject: "Kami relayer ETH float is low",
    relayerLowBody: (eth: string, addr: string) => `The relayer (${addr}) holds ${eth} ETH, below the 0.01 ETH float. Payout execution is paused until it is topped up.`,
  },
} as const;
