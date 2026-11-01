"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSingleFlight } from "@/lib/use-single-flight";

export function NewApplication() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useSingleFlight();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void flight.run(plan);
  }

  async function plan() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Couldn't read that job.");
    router.push(`/apply/${json.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
          placeholder="https://job-boards.greenhouse.io/company/jobs/123456"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button disabled={busy} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60">
          {busy ? "Reading form…" : "Plan application"}
        </button>
      </div>
      {busy && <p className="text-xs text-neutral-500">Reading the job and planning answers. Written answers from a local model can take a minute.</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
