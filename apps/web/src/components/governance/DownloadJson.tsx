"use client";

/** Saves the JSON already rendered on the page as a file (no network call). */
import { me as copy } from "@/copy";

export function DownloadJson({ json, filename }: { json: string; filename: string }) {
  function save() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" className="btn" onClick={save}>
      {copy.export}
    </button>
  );
}
