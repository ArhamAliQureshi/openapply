"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSingleFlight } from "@/lib/use-single-flight";

type Row = { id: string; question: string; answer: string };

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

export function AnswerLibrary({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const adding = useSingleFlight();

  async function add() {
    setError(null);
    const res = await fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, answer }) });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
    router.refresh();
    setQuestion("");
    setAnswer("");
  }

  async function update(id: string, value: string) {
    const before = rows.find((x) => x.id === id)?.answer;
    // Show the new answer right away; roll back if the server rejects it.
    setRows((r) => r.map((x) => (x.id === id ? { ...x, answer: value } : x)));
    const res = await fetch(`/api/answers/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: value }),
    }).catch(() => null);
    if (!res?.ok) {
      setRows((r) => r.map((x) => (x.id === id && before !== undefined ? { ...x, answer: before } : x)));
      setError("Couldn't save that answer.");
    }
  }

  async function remove(id: string) {
    const index = rows.findIndex((x) => x.id === id);
    const row = rows[index];
    if (!row) return;
    // Remove immediately; put it back where it was if the delete fails.
    setRows((r) => r.filter((x) => x.id !== id));
    const res = await fetch(`/api/answers/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setRows((r) => [...r.slice(0, index), row, ...r.slice(index)]);
      setError("Couldn't delete that answer.");
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <section className="space-y-2 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Add an answer</h2>
        <input className={inputCls} placeholder="Question, exactly as forms ask it" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <textarea className={`${inputCls} min-h-16`} placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => adding.run(add)}
            disabled={adding.pending}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {adding.pending ? "Saving…" : "Save"}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No saved answers yet. They appear here as you answer questions on the Apply page.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium">{r.question}</p>
                <button type="button" onClick={() => remove(r.id)} className="shrink-0 text-xs text-neutral-500 hover:text-red-600">
                  Delete
                </button>
              </div>
              <textarea
                className={`${inputCls} min-h-12`}
                defaultValue={r.answer}
                onBlur={(e) => e.target.value.trim() && e.target.value !== r.answer && update(r.id, e.target.value)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
