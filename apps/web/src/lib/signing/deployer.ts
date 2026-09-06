/**
 * The deployer role: pays for Safe / Hats / Roles deployments (architecture
 * §7.1). The scripts live in `@kami/chain`; this module only supplies the
 * KMS-backed account so no raw key is ever passed on a command line in production.
 * The deployer is never a Safe owner (`assertOwnersValid` in `@kami/chain`).
 */
import type { Address, LocalAccount } from "viem";
import { accountFor } from "./kms";
import type { TreasuryDeps } from "@/lib/treasury/deps";

export async function deployerAddress(deps: TreasuryDeps): Promise<Address> {
  return (await deps.backend()).getAddress("deployer");
}

/** The `ChainAccount` `deploySafe` / `deployHatsTree` / `enableRoles` take. */
export async function deployerAccount(deps: TreasuryDeps): Promise<LocalAccount> {
  return accountFor(await deps.backend(), "deployer");
}

/** The keeper (allowance phase, §7.5) is a separate key from the proposer by design. */
export async function keeperAccount(deps: TreasuryDeps): Promise<LocalAccount> {
  return accountFor(await deps.backend(), "keeper");
}
