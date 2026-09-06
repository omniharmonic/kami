"use client";

/**
 * In-app capture (T2.8). Opens the phone camera with
 * `<input type="file" accept="image/*" capture="environment">`, hashes each
 * file in the browser with SubtleCrypto, asks `/api/evidence/upload` for
 * presigned PUTs, uploads, then calls `/api/evidence/finalize`, which builds
 * the submission and its `evidence_summary` and moves the bounty to review.
 *
 * The note is sanitised again on the server; nothing typed here reaches the
 * model except the truncated, URL-stripped note.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { evidence as copy } from "@/copy";
import { requestCaptureToken } from "@/actions/governance";

type Picked = { file: File; sha256: string };

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function Capture({ bountyId, maxFiles, maxFileMb }: { bountyId: string; maxFiles: number; maxFileMb: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [note, setNote] = useState("");
  const [licence, setLicence] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setFailed(false);
    setMessage(null);
    if (picked.length + files.length > maxFiles) {
      setFailed(true);
      setMessage(copy.tooMany(maxFiles));
      return;
    }
    for (const f of files) {
      if (f.size > maxFileMb * 1024 * 1024) {
        setFailed(true);
        setMessage(copy.tooLarge(maxFileMb));
        return;
      }
    }
    setBusy(copy.hashing);
    try {
      const hashed: Picked[] = [];
      for (const file of files) hashed.push({ file, sha256: await sha256Hex(file) });
      setPicked((p) => [...p, ...hashed]);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function submit() {
    if (!licence) {
      setFailed(true);
      setMessage(copy.licenceRequired);
      return;
    }
    if (!picked.length) return;
    setFailed(false);
    setBusy(copy.uploading(0, picked.length));
    try {
      const { token } = await requestCaptureToken(bountyId);
      const res = await fetch("/api/evidence/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bounty_id: bountyId,
          licence_accepted: true,
          capture_token: token,
          files: picked.map((p) => ({ mime: p.file.type || "image/jpeg", bytes: p.file.size, sha256: p.sha256, in_app_capture: true })),
        }),
      });
      const body = (await res.json()) as { files?: Array<{ sha256: string; put: { url: string; headers: Record<string, string> } }>; message?: string };
      if (!res.ok || !body.files) throw new Error(body.message ?? "upload failed");
      let done = 0;
      for (const f of body.files) {
        const match = picked.find((p) => p.sha256 === f.sha256);
        if (!match) continue;
        const put = await fetch(f.put.url, { method: "PUT", headers: f.put.headers, body: match.file });
        if (!put.ok) throw new Error("PUT failed");
        done++;
        setBusy(copy.uploading(done, body.files.length));
      }
      setBusy(copy.finalizing);
      const fin = await fetch("/api/evidence/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bounty_id: bountyId, note }),
      });
      const finBody = (await fin.json()) as { message?: string };
      if (!fin.ok) throw new Error(finBody.message ?? "finalize failed");
      setPicked([]);
      setNote("");
      setMessage(copy.done);
      router.refresh();
    } catch (err) {
      console.warn("[capture]", (err as Error).message);
      setFailed(true);
      setMessage(copy.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card stack">
      <h3 style={{ margin: 0, fontSize: "1rem" }}>{copy.heading}</h3>
      <p className="muted" style={{ margin: 0 }}>{copy.intro}</p>

      <label className="btn tap" style={{ alignSelf: "flex-start" }}>
        {copy.choose}
        <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple onChange={onPick} style={{ display: "none" }} />
      </label>
      {picked.length > 0 && (
        <p className="chip" style={{ alignSelf: "flex-start" }}>{copy.chosen(picked.length)}</p>
      )}

      <label>
        <span className="eyebrow">{copy.note}</span>
        <textarea
          className="field"
          style={{ minHeight: "4.5rem", paddingBlock: "0.5rem" }}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <span className="faint" style={{ fontSize: "0.8rem" }}>{copy.noteHint}</span>
      </label>

      <details>
        <summary className="tap" style={{ cursor: "pointer" }}>{copy.licenceTitle}</summary>
        <ul>{copy.licence.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
      <label className="check">
        <input type="checkbox" checked={licence} onChange={(e) => setLicence(e.target.checked)} />
        <span>{copy.licenceAccept}</span>
      </label>

      <button type="button" className="btn btn-primary" onClick={submit} disabled={Boolean(busy) || picked.length === 0 || !licence}>
        {busy ?? copy.finalize}
      </button>
      {message && (
        <p role={failed ? "alert" : "status"} style={{ margin: 0, color: failed ? "var(--danger)" : "var(--moss)" }}>
          {message}
        </p>
      )}
      <noscript>
        <p className="muted" style={{ margin: 0 }}>
          Capturing evidence needs JavaScript, because each photo is hashed on your own device before it is uploaded.
        </p>
      </noscript>
    </div>
  );
}
