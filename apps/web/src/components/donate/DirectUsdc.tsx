"use client";

/**
 * The direct-USDC route, given the same weight as the card: same heading
 * level, same card, above the fold of the second screen, no "advanced" framing.
 * The QR is a data URL rendered on the server (`safeQrDataUrl`), so nothing is
 * fetched from a third party to draw it.
 */
import { donateCopy } from "@/lib/donations/copy";

export type DirectUsdcProps = {
  name: string;
  safeAddress: string | null;
  chainName: string;
  chainId: number;
  tokenAddress: string;
  qrDataUrl: string | null;
};

export function DirectUsdc({ name, safeAddress, chainName, chainId, tokenAddress, qrDataUrl }: DirectUsdcProps) {
  return (
    <section className="section" aria-labelledby="direct-h">
      <h2 id="direct-h">{donateCopy.direct.heading}</h2>
      <div className="card stack">
        {!safeAddress ? (
          <p className="muted" style={{ margin: 0 }}>{donateCopy.direct.noSafe}</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>{donateCopy.direct.body}</p>
            <p style={{ margin: 0 }}>
              <span className="eyebrow">{donateCopy.direct.address}</span>
              <br />
              <code style={{ wordBreak: "break-all" }}>{safeAddress}</code>
            </p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- a data: URL, not a remote asset
              <img src={qrDataUrl} alt={donateCopy.direct.qrAlt(name)} width={240} height={240} style={{ imageRendering: "pixelated", maxWidth: "240px" }} />
            )}
            <p className="faint" style={{ margin: 0 }}>
              <span className="eyebrow">{donateCopy.direct.network}</span> {chainName} (chain {chainId})
              <br />
              <span className="eyebrow">{donateCopy.direct.token}</span> USDC <code style={{ wordBreak: "break-all" }}>{tokenAddress}</code>
            </p>
            <p style={{ margin: 0 }}>{donateCopy.fees.direct}</p>
            <p className="muted" style={{ margin: 0 }}>{donateCopy.direct.verifyNote}</p>
            <details>
              <summary className="tap" style={{ cursor: "pointer" }}>{donateCopy.direct.claimHeading}</summary>
              <p className="muted" style={{ margin: "0.4rem 0 0" }}>{donateCopy.direct.claimBody}</p>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
