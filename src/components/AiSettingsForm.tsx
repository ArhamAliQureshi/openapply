"use client";

import { useEffect, useMemo, useState } from "react";
import type { AiProvider, AiSettings, ModelChoice } from "@/lib/ai/config";
import type { OpenRouterModel } from "@/lib/ai/openrouter";
import { useSingleFlight } from "@/lib/use-single-flight";

type Status = Record<AiProvider, { ready: boolean; note: string }>;
type Task = "parse" | "write";

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openrouter: "OpenRouter (hundreds of models, free & paid)",
  ollama: "Local (Ollama on this Mac, free, slow)",
  claude: "Claude (Anthropic API)",
};

const TASKS: { key: Task; title: string; hint: string }[] = [
  {
    key: "parse",
    title: "Resume reading",
    hint: "Turns your uploaded resume into profile fields. Needs a model that supports structured (JSON) output.",
  },
  {
    key: "write",
    title: "Written answers",
    hint: "Writes answers to open-ended questions like “Why do you want to work here?”. These go to employers, so quality matters.",
  },
];

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

const price = (m: OpenRouterModel) =>
  m.free ? "free" : `$${m.promptPrice.toFixed(2)} in / $${m.completionPrice.toFixed(2)} out per 1M tokens`;

export function AiSettingsForm(props: {
  initial: AiSettings;
  status: Status;
  claudeModels: string[];
  ollamaModels: string[];
}) {
  const [settings, setSettings] = useState(props.initial);
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const saving = useSingleFlight();

  useEffect(() => {
    fetch("/api/ai-settings/models")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Couldn't load models");
        setModels(json);
      })
      .catch((e) => setModelsError(e.message));
  }, []);

  const set = (task: Task, choice: ModelChoice) => {
    setSaved(null);
    setSettings((s) => ({ ...s, [task]: choice }));
  };

  async function save() {
    const res = await fetch("/api/ai-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
    setSaved(res.ok ? "Saved. New uploads and applications use these models." : "Couldn't save.");
  }

  return (
    <div className="mt-6 space-y-4">
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Providers</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          {(Object.keys(PROVIDER_LABEL) as AiProvider[]).map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${props.status[p].ready ? "bg-emerald-500" : "bg-neutral-300"}`} />
              <span className="font-medium">{PROVIDER_LABEL[p]}</span>
              <span className="text-neutral-500">— {props.status[p].note}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-500">
          API keys live in <code>applykit/.env.local</code> (OPENROUTER_API_KEY, ANTHROPIC_API_KEY) and are never shown here. Restart the app after changing them.
        </p>
      </section>

      {TASKS.map((t) => (
        <TaskCard
          key={t.key}
          task={t.key}
          title={t.title}
          hint={t.hint}
          choice={settings[t.key]}
          onChange={(c) => set(t.key, c)}
          status={props.status}
          openrouterModels={models}
          modelsError={modelsError}
          claudeModels={props.claudeModels}
          ollamaModels={props.ollamaModels}
        />
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => saving.run(save)}
          disabled={saving.pending}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
        >
          {saving.pending ? "Saving…" : "Save AI settings"}
        </button>
        {saved && <span className="text-sm text-neutral-700">{saved}</span>}
      </div>
    </div>
  );
}

function TaskCard(props: {
  task: Task;
  title: string;
  hint: string;
  choice: ModelChoice;
  onChange: (c: ModelChoice) => void;
  status: Status;
  openrouterModels: OpenRouterModel[] | null;
  modelsError: string | null;
  claudeModels: string[];
  ollamaModels: string[];
}) {
  const { choice, onChange, task } = props;
  const [freeOnly, setFreeOnly] = useState(true);
  // Resume reading needs guaranteed JSON output; other models are hidden unless the user opts in.
  const [jsonOnly, setJsonOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; seconds: number; result: string } | null>(null);

  const orOptions = useMemo(() => {
    const all = props.openrouterModels ?? [];
    const q = search.trim().toLowerCase();
    return all
      .filter((m) => (task === "parse" && jsonOnly ? m.structured : true))
      .filter((m) => !freeOnly || m.free)
      .filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [props.openrouterModels, task, freeOnly, search, jsonOnly]);

  // Models the JSON filter is hiding, e.g. the free Gemma 4 variants.
  const hiddenNoJson = (props.openrouterModels ?? []).filter((m) => (!freeOnly || m.free) && !m.structured);

  const selected = props.openrouterModels?.find((m) => m.id === choice.model);

  const switchProvider = (provider: AiProvider) => {
    const model =
      provider === "claude"
        ? props.claudeModels[0]
        : provider === "ollama"
          ? (props.ollamaModels[0] ?? "gemma4:e2b")
          : (orOptions[0]?.id ?? "nvidia/nemotron-3.5-super-vl:free");
    onChange({ provider, model, fallbacks: [] });
    setTest(null);
  };

  async function runTest() {
    setTesting(true);
    setTest(null);
    const started = Date.now();
    const res = await fetch("/api/ai-settings/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task, choice }),
    }).catch(() => null);
    if (res?.ok && res.body && res.headers.get("content-type")?.startsWith("text/plain")) {
      // Written-answer test streams token by token.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setTest({ ok: true, seconds: (Date.now() - started) / 1000, result: text });
      }
      const [answer, error] = text.split("\n[error] ");
      setTest({ ok: !error && answer.trim().length > 20, seconds: (Date.now() - started) / 1000, result: error ?? answer.trim() });
    } else {
      setTest((await res?.json().catch(() => null)) ?? { ok: false, seconds: 0, result: "Test request failed." });
    }
    setTesting(false);
  }

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold">{props.title}</h2>
        <p className="text-xs text-neutral-500">{props.hint}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["openrouter", "ollama", "claude"] as AiProvider[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => switchProvider(p)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              choice.provider === p ? "border-teal-700 bg-teal-50 font-medium text-teal-800" : "border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {p === "openrouter" ? "OpenRouter" : p === "ollama" ? "Local (Ollama)" : "Claude"}
            {!props.status[p].ready && <span className="ml-1 text-xs text-amber-700">(not set up)</span>}
          </button>
        ))}
      </div>

      {choice.provider === "openrouter" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <input className={`${inputCls} max-w-xs`} placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
              Free only
            </label>
            {task === "parse" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={jsonOnly} onChange={(e) => setJsonOnly(e.target.checked)} />
                Only models with guaranteed JSON output
              </label>
            )}
          </div>
          {task === "parse" && jsonOnly && hiddenNoJson.length > 0 && (
            <p className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-600">
              {hiddenNoJson.length} {freeOnly ? "free " : ""}models are hidden because their hosts can&apos;t guarantee exact JSON output (e.g.{" "}
              {hiddenNoJson
                .slice(0, 3)
                .map((m) => m.name)
                .join(", ")}
              ). Resume reading with them can come back broken. They&apos;re still available for written answers.
            </p>
          )}
          {task === "parse" && !jsonOnly && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              Showing all models. Ones without guaranteed JSON output may return broken resume data; use “Test this model” before saving.
            </p>
          )}
          {props.modelsError ? (
            <p className="text-sm text-red-600">{props.modelsError}</p>
          ) : !props.openrouterModels ? (
            <p className="text-sm text-neutral-500">Loading models…</p>
          ) : (
            <select
              className={inputCls}
              value={choice.model}
              onChange={(e) => {
                onChange({ ...choice, model: e.target.value });
                setTest(null);
              }}
            >
              {!orOptions.some((m) => m.id === choice.model) && <option value={choice.model}>{choice.model}</option>}
              {orOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {price(m)} · {Math.round(m.contextLength / 1000)}k context
                </option>
              ))}
            </select>
          )}
          {selected && <p className="text-xs text-neutral-500">{selected.id} · {price(selected)}</p>}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">
              Backup models (comma separated, tried in order if the main one is rate-limited or down)
            </span>
            <input
              className={inputCls}
              value={choice.fallbacks.join(", ")}
              onChange={(e) => onChange({ ...choice, fallbacks: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 4) })}
            />
          </label>
        </div>
      )}

      {choice.provider === "ollama" && (
        <select className={inputCls} value={choice.model} onChange={(e) => onChange({ ...choice, model: e.target.value })}>
          {[...new Set([choice.model, ...props.ollamaModels])].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}

      {choice.provider === "claude" && (
        <select className={inputCls} value={choice.model} onChange={(e) => onChange({ ...choice, model: e.target.value })}>
          {props.claudeModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-3">
        <button
          type="button"
          onClick={runTest}
          disabled={testing}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test this model"}
        </button>
        {test && (
          <p className={`text-sm ${test.ok ? "text-emerald-700" : "text-red-600"}`}>
            {test.ok ? "✓ Works" : "✗ Problem"} ({test.seconds.toFixed(1)}s): {test.result}
          </p>
        )}
      </div>
    </section>
  );
}
