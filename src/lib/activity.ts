import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// In-memory registry of the app's background work ("agents"): feed refreshes, autopilot runs,
// form planning, headless form filling and AI calls. Shown live on the Agents page.
// History is kept for the current server process only.

export type ActivityKind = "autopilot" | "feed" | "plan" | "fill" | "resume" | "ai";

export type Activity = {
  id: string;
  parentId: string | null; // e.g. a form fill started by an autopilot run
  kind: ActivityKind;
  label: string;
  step: string; // what it's doing right now
  status: "running" | "done" | "failed";
  result: string | null;
  startedAt: number;
  endedAt: number | null;
};

const HISTORY = 100;

// On globalThis: Next can load each route as a separate module instance.
const store = globalThis as { __activities?: Activity[] };
const activities = (store.__activities ??= []);
const current = new AsyncLocalStorage<Activity>();

export type ActivityCtx = { step(text: string): void; result(text: string): void };

/** Runs `fn` as a tracked activity. Nested tracked calls are linked to it as children. */
export async function track<T>(kind: ActivityKind, label: string, fn: (ctx: ActivityCtx) => Promise<T>): Promise<T> {
  const a: Activity = {
    id: crypto.randomUUID(),
    parentId: current.getStore()?.id ?? null,
    kind,
    label,
    step: "Starting…",
    status: "running",
    result: null,
    startedAt: Date.now(),
    endedAt: null,
  };
  activities.unshift(a);
  // Drop the oldest finished entries beyond the history limit.
  for (let i = activities.length - 1; i >= 0 && activities.length > HISTORY; i--) {
    if (activities[i].status !== "running") activities.splice(i, 1);
  }
  const ctx: ActivityCtx = {
    step: (text) => {
      a.step = text;
    },
    result: (text) => {
      a.result = text;
    },
  };
  try {
    const value = await current.run(a, () => fn(ctx));
    a.status = "done";
    return value;
  } catch (err) {
    a.status = "failed";
    a.result = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw err;
  } finally {
    a.endedAt = Date.now();
  }
}

/** Updates the step of whichever tracked activity is running in this async context (no-op otherwise). */
export function step(text: string) {
  const a = current.getStore();
  if (a) a.step = text;
}

/** A log array whose entries also show up as the current step on the Agents page. */
export function trackedLog(): string[] {
  const log: string[] = [];
  const push = log.push.bind(log);
  log.push = (...items: string[]) => {
    if (items.length) step(items[items.length - 1]);
    return push(...items);
  };
  return log;
}

export function listActivities(): Activity[] {
  return activities.map((a) => ({ ...a }));
}
