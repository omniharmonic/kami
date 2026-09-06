import type { DbOrTx } from "@/db/events";

/** Run `fn` in a transaction (a savepoint when already inside one). */
export async function withTx<T>(db: DbOrTx, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  return (db as { transaction: (cb: (tx: DbOrTx) => Promise<T>) => Promise<T> }).transaction(fn);
}

export function newId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function usdc(s: string | number | null | undefined): number {
  const n = typeof s === "number" ? s : Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
}
