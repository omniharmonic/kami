/**
 * What is inside the bundle, named and explained, before anyone downloads it.
 * A file list is also the answer to "what am I about to run" — nothing in the
 * bundle executes on its own, and saying which file is instructions, which is
 * configuration and which is reference is part of saying so.
 */
import type { BundleFile } from "@/lib/connect/bundle";

export function FileList({ files }: { files: readonly BundleFile[] }) {
  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} data-testid="bundle-files">
      {files.map((f) => (
        <li key={f.path} className="sunken" data-file={f.path}>
          <code style={{ fontWeight: 600 }}>{f.path}</code>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.88rem" }}>{f.purpose}</p>
        </li>
      ))}
    </ul>
  );
}
