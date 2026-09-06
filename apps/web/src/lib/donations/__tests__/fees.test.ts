/**
 * The fee table is data, and this is the test that keeps the page, the ledger
 * and the estimate telling the same story. Every rate carries its source and
 * every rate is *verify* until someone reads it off the live account.
 */
import { describe, expect, it } from "vitest";
import { estimateFee, feeExample, FEE_TABLE, feeText, round2 } from "../fees";

describe("FEE_TABLE", () => {
  it("holds the three rails with the PRD's numbers and their sources", () => {
    expect(FEE_TABLE.card).toMatchObject({ percent: 2.9, fixed_usd: 0.3, verified: false });
    expect(FEE_TABLE.stablecoin_checkout).toMatchObject({ percent: 1.5, fixed_usd: 0, verified: false });
    expect(FEE_TABLE.usdc_direct).toMatchObject({ percent: 0, fixed_usd: 0 });
    for (const row of Object.values(FEE_TABLE)) expect(row.source.length).toBeGreaterThan(20);
  });

  it("marks the two Stripe rates unverified until docs/verify.md #13 is ticked", () => {
    expect(FEE_TABLE.card.verified).toBe(false);
    expect(FEE_TABLE.card.source).toContain("verify");
    expect(FEE_TABLE.stablecoin_checkout.source).toContain("verify");
  });
});

describe("estimateFee", () => {
  it("matches the worked example in the architecture's Appendix A.5", () => {
    expect(estimateFee("card", 20)).toMatchObject({ gross_usd: 20, fee_usd: 0.88, net_usd: 19.12, basis: "estimate" });
  });

  it("never takes more than the gift, and takes nothing on the direct rail", () => {
    expect(estimateFee("card", 0.1).net_usd).toBe(0);
    expect(estimateFee("usdc_direct", 50)).toMatchObject({ fee_usd: 0, net_usd: 50 });
    expect(estimateFee("stablecoin_checkout", 100)).toMatchObject({ fee_usd: 1.5, net_usd: 98.5 });
  });

  it("always says it is an estimate", () => {
    expect(estimateFee("card", 100).basis).toBe("estimate");
  });
});

describe("the strings the page shows", () => {
  it("states the rate in numbers", () => {
    expect(feeText("card")).toBe("2.9% + 30¢");
    expect(feeText("stablecoin_checkout")).toBe("1.5%");
    expect(feeText("usdc_direct")).toBe("no platform fee");
  });

  it("shows the arithmetic, not just the rate", () => {
    expect(feeExample("card", 20)).toBe("$20.00 → 2.9% + 30¢ = $0.88 → $19.12 reaches the Safe.");
    expect(feeExample("usdc_direct", 20)).toContain("arrives whole");
  });
});

describe("round2", () => {
  it("rounds money the way the ledger does", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(19.125)).toBe(19.13);
    expect(round2(1.005)).toBe(1.01);
  });
});
