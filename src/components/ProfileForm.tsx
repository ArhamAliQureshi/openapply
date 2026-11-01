"use client";

import { useRef, useState } from "react";
import type { Profile } from "@/lib/profile-schema";
import { useSingleFlight } from "@/lib/use-single-flight";

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

type TextKey = {
  [K in keyof Profile]: Profile[K] extends string ? K : never;
}[keyof Profile];

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

const EEO_FIELDS: { key: keyof Profile["eeo"]; label: string }[] = [
  { key: "gender", label: "Gender" },
  { key: "race", label: "Race" },
  { key: "hispanic", label: "Hispanic/Latino" },
  { key: "veteran", label: "Veteran status" },
  { key: "disability", label: "Disability status" },
];

function ListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  // Keep the raw text while typing so commas/spaces aren't swallowed.
  const [raw, setRaw] = useState(value.join(", "));
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      <input
        className={inputCls}
        value={raw}
        placeholder={placeholder}
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean));
        }}
      />
    </label>
  );
}

export function ProfileForm({ initial }: { initial: Profile }) {
  const [p, setP] = useState(initial);
  const saving = useSingleFlight();
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setP((x) => ({ ...x, [key]: value }));

  const text = (key: TextKey, label: string, placeholder?: string, wide = false) => (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      <input className={inputCls} value={p[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} />
    </label>
  );

  const check = (key: "willingToRelocate" | "over18" | "aiWrittenAnswers", label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={p[key]} onChange={(e) => set(key, e.target.checked)} />
      {label}
    </label>
  );

  async function save() {
    setStatus("Saving…");
    // Resume file and job-search settings are saved by their own endpoints.
    const { resumeFile: _r, feed: _f, autopilot: _a, ...body } = p;
    void _r;
    void _f;
    void _a;
    const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setStatus(res.ok ? "Saved" : "Save failed");
  }

  async function upload(file: File) {
    setUploading(true);
    setStatus("Uploading and reading your resume… (a local model can take 1–2 minutes)");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/profile/resume-file", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) return setStatus(json.error ?? "Upload failed");
    if (json.prefillError) {
      // Keep the message visible: the file is saved, but nothing was filled in.
      setStatus(`Resume saved, but reading it failed: ${json.prefillError} Click Replace to try again.`);
      setP((x) => ({ ...x, resumeFile: { path: "", filename: file.name } }));
      return;
    }
    // Reload so prefilled fields (including list fields) show up.
    window.location.reload();
  }

  return (
    <div className="mt-6 space-y-4 pb-24">
      <Card title="Resume to attach" hint="This exact file is uploaded to every application. Uploading also fills empty fields below.">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-700">{p.resumeFile ? p.resumeFile.filename : "No resume uploaded yet"}</span>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-neutral-300 px-3 py-1 hover:bg-neutral-50 disabled:opacity-50"
          >
            {uploading ? "Reading…" : p.resumeFile ? "Replace" : "Upload PDF or DOCX"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload(f);
            }}
          />
        </div>
      </Card>

      <Card title="Contact">
        <div className="grid grid-cols-2 gap-3">
          {text("firstName", "First name")}
          {text("lastName", "Last name")}
          {text("preferredName", "Preferred first name")}
          {text("email", "Email")}
          {text("phone", "Phone", "+1 415 555 0142")}
          {text("phoneCountry", "Phone country", "United States")}
          {text("location", "City", "San Francisco, CA")}
          {text("country", "Country", "United States")}
        </div>
      </Card>

      <Card title="Links">
        <div className="grid grid-cols-2 gap-3">
          {text("linkedin", "LinkedIn URL")}
          {text("github", "GitHub URL")}
          {text("website", "Website / portfolio", undefined, true)}
        </div>
      </Card>

      <Card title="Current role">
        <div className="grid grid-cols-2 gap-3">
          {text("currentTitle", "Current title")}
          {text("currentCompany", "Current company")}
        </div>
      </Card>

      <Card title="Work authorization" hint="One row per country you might apply in. Used for 'authorized to work' and 'sponsorship' questions.">
        {p.workAuthorizations.map((w, i) => (
          <div key={i} className="flex flex-wrap items-center gap-4 text-sm">
            <input
              className={`${inputCls} max-w-56`}
              value={w.country}
              placeholder="Country"
              onChange={(e) => set("workAuthorizations", p.workAuthorizations.map((x, k) => (k === i ? { ...x, country: e.target.value } : x)))}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={w.authorized}
                onChange={(e) => set("workAuthorizations", p.workAuthorizations.map((x, k) => (k === i ? { ...x, authorized: e.target.checked } : x)))}
              />
              Authorized to work
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={w.needsSponsorship}
                onChange={(e) => set("workAuthorizations", p.workAuthorizations.map((x, k) => (k === i ? { ...x, needsSponsorship: e.target.checked } : x)))}
              />
              Needs visa sponsorship
            </label>
            <button
              type="button"
              className="text-xs text-neutral-500 hover:text-red-600"
              onClick={() => set("workAuthorizations", p.workAuthorizations.filter((_, k) => k !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-sm text-teal-700 hover:underline"
          onClick={() => set("workAuthorizations", [...p.workAuthorizations, { country: "", authorized: true, needsSponsorship: false }])}
        >
          + Add country
        </button>
      </Card>

      <Card title="Background facts" hint="Used for 'Have you worked for X before?', citizenship, export-control and clearance questions.">
        <ListField label="Companies you've worked for (comma separated)" value={p.pastEmployers} onChange={(v) => set("pastEmployers", v)} />
        <div className="grid grid-cols-2 gap-3">
          <ListField label="Citizenship(s)" value={p.citizenships} onChange={(v) => set("citizenships", v)} placeholder="e.g. Pakistan" />
          {text("securityClearance", "Security clearance held", "None")}
        </div>
      </Card>

      <Card title="Common questions">
        <div className="grid grid-cols-2 gap-3">
          {text("salaryExpectation", "Salary expectation", "e.g. $150,000")}
          {text("noticePeriod", "Notice period / start date", "e.g. 2 weeks")}
          {text("howDidYouHear", "How did you hear about us?", "Company careers page", true)}
        </div>
        <div className="flex flex-wrap gap-6 pt-1">
          {check("willingToRelocate", "Willing to relocate")}
          {check("over18", "18 or older")}
        </div>
        <label className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={p.autoAcceptAttestations}
            onChange={(e) => set("autoAcceptAttestations", e.target.checked)}
          />
          <span>
            Auto-accept standard certifications and consents
            <span className="block text-xs text-neutral-600">
              e.g. &quot;I certify my information is correct&quot;, consent to AI interview transcription, and arbitration agreements. These are legal
              agreements made in your name; leave off to review each one.
            </span>
          </span>
        </label>
      </Card>

      <Card
        title="Written answers"
        hint="For required questions like 'Why do you want to work here?'. The AI writes from this paragraph and the job description, and never invents experience."
      >
        {check("aiWrittenAnswers", "Let AI write answers to required free-text questions")}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600">About me (facts the AI may use)</span>
          <textarea className={`${inputCls} min-h-28`} value={p.aboutMe} onChange={(e) => set("aboutMe", e.target.value)} />
        </label>
      </Card>

      <Card title="Equal-opportunity questions" hint="Leave blank to always choose 'I don't wish to answer'.">
        <div className="grid grid-cols-2 gap-3">
          {EEO_FIELDS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
              <input
                className={inputCls}
                value={p.eeo[key]}
                placeholder="Decline to answer"
                onChange={(e) => set("eeo", { ...p.eeo, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-4 px-4 py-3">
          {status && <span className="text-sm text-neutral-600">{status}</span>}
          <button
            type="button"
            onClick={() => saving.run(save)}
            disabled={saving.pending}
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {saving.pending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
