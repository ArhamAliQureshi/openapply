"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useSingleFlight } from "@/lib/use-single-flight";

const ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export function UploadCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "creating">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const flight = useSingleFlight();

  const submit = (file: File | null) => flight.run(() => upload(file));

  async function upload(file: File | null) {
    setError(null);
    setStatus(file ? "parsing" : "creating");
    const body = new FormData();
    if (file) body.append("file", file);
    try {
      const res = await fetch("/api/resumes", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`);
      router.push(`/resumes/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStatus("idle");
    }
  }

  const busy = status !== "idle";

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) submit(f);
        }}
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          dragging ? "border-teal-600 bg-teal-50" : "border-neutral-300 hover:border-teal-600 hover:bg-neutral-50"
        } disabled:cursor-wait disabled:opacity-70`}
      >
        {status === "parsing" ? (
          <>
            <span className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
            <span className="font-medium">Reading your resume with AI…</span>
            <span className="mt-1 text-sm text-neutral-500">Usually under a minute with Claude; a local model can take several minutes.</span>
          </>
        ) : (
          <>
            <span className="font-medium">Drop your resume here, or click to upload</span>
            <span className="mt-1 text-sm text-neutral-500">PDF, DOCX or TXT · up to 10 MB</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) submit(f);
        }}
      />
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(null)}
          className="text-teal-700 hover:underline disabled:opacity-50"
        >
          {status === "creating" ? "Creating…" : "Or start from a blank resume"}
        </button>
        {error && <p role="alert" className="text-red-600">{error}</p>}
      </div>
    </div>
  );
}
