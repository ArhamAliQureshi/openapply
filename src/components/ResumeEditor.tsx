"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  emptyEducation, emptyProject, emptySkillGroup, emptyWork,
  type Resume,
} from "@/lib/resume-schema";
import { TEMPLATES, type Template } from "@/lib/templates";
import { ResumePreview } from "./ResumePreview";

type SaveState = "saved" | "dirty" | "saving" | "error";

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

function Field({
  label, value, onChange, multiline, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {multiline ? (
        <textarea className={`${inputCls} min-h-24`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {onAdd && (
          <button type="button" onClick={onAdd} className="text-sm text-teal-700 hover:underline">+ Add</button>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ItemCard({ onRemove, onUp, onDown, children }: {
  onRemove: () => void; onUp?: () => void; onDown?: () => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex justify-end gap-3 text-xs text-neutral-500">
        {onUp && <button type="button" onClick={onUp} aria-label="Move up">↑</button>}
        {onDown && <button type="button" onClick={onDown} aria-label="Move down">↓</button>}
        <button type="button" onClick={onRemove} className="hover:text-red-600">Remove</button>
      </div>
      {children}
    </div>
  );
}

// One bullet per line keeps editing simple and maps 1:1 to highlights[].
function BulletsField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label} (one per line)</span>
      <textarea
        className={`${inputCls} min-h-28 font-mono text-[13px]`}
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
      />
    </label>
  );
}

const move = <T,>(xs: T[], i: number, d: -1 | 1) => {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};
const replace = <T,>(xs: T[], i: number, patch: Partial<T>) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x));
const remove = <T,>(xs: T[], i: number) => xs.filter((_, k) => k !== i);

export function ResumeEditor({
  id, initialTitle, initialData, initialTemplate,
}: {
  id: string; initialTitle: string; initialData: Resume; initialTemplate: Template;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [data, setData] = useState(initialData);
  const [template, setTemplate] = useState(initialTemplate);
  const [save, setSave] = useState<SaveState>("saved");
  const firstRender = useRef(true);

  // Debounced autosave.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSave("dirty");
    const t = setTimeout(async () => {
      setSave("saving");
      const res = await fetch(`/api/resumes/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() || "Untitled resume", data, template }),
      }).catch(() => null);
      setSave(res?.ok ? "saved" : "error");
    }, 700);
    return () => clearTimeout(t);
  }, [id, title, data, template]);

  const b = data.basics;
  const setBasics = (patch: Partial<Resume["basics"]>) => setData((d) => ({ ...d, basics: { ...d.basics, ...patch } }));
  const set = <K extends keyof Resume>(key: K, value: Resume[K]) => setData((d) => ({ ...d, [key]: value }));

  return (
    <div className="flex h-screen flex-col">
      <header className="no-print flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2.5">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Resumes</Link>
        <input
          className="min-w-0 flex-1 rounded px-2 py-1 text-sm font-semibold outline-none hover:bg-neutral-100 focus:bg-neutral-100"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Resume title"
        />
        <span className={`text-xs ${save === "error" ? "text-red-600" : "text-neutral-500"}`}>
          {{ saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed" }[save]}
        </span>
        <select
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
          value={template}
          onChange={(e) => setTemplate(e.target.value as Template)}
          aria-label="Template"
        >
          {TEMPLATES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select>
        <a
          href={`/resumes/${id}/print`}
          target="_blank"
          className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          Download PDF
        </a>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(380px,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-4 overflow-y-auto bg-neutral-100 p-4">
          <Section title="Personal details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name" value={b.name} onChange={(v) => setBasics({ name: v })} />
              <Field label="Headline" value={b.label} onChange={(v) => setBasics({ label: v })} placeholder="Senior Backend Engineer" />
              <Field label="Email" value={b.email} onChange={(v) => setBasics({ email: v })} />
              <Field label="Phone" value={b.phone} onChange={(v) => setBasics({ phone: v })} />
              <Field label="Location" value={b.location} onChange={(v) => setBasics({ location: v })} />
              <Field label="Website" value={b.url} onChange={(v) => setBasics({ url: v })} />
            </div>
            {b.profiles.map((p, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="w-32"><Field label="Network" value={p.network} onChange={(v) => setBasics({ profiles: replace(b.profiles, i, { network: v }) })} /></div>
                <div className="flex-1"><Field label="URL" value={p.url} onChange={(v) => setBasics({ profiles: replace(b.profiles, i, { url: v }) })} /></div>
                <button type="button" className="pb-2 text-xs text-neutral-500 hover:text-red-600" onClick={() => setBasics({ profiles: remove(b.profiles, i) })}>Remove</button>
              </div>
            ))}
            <button type="button" className="text-sm text-teal-700 hover:underline" onClick={() => setBasics({ profiles: [...b.profiles, { network: "", url: "" }] })}>
              + Add profile link
            </button>
          </Section>

          <Section title="Summary">
            <Field label="Professional summary" multiline value={b.summary} onChange={(v) => setBasics({ summary: v })} />
          </Section>

          <Section title="Experience" onAdd={() => set("work", [...data.work, emptyWork()])}>
            {data.work.map((w, i) => (
              <ItemCard
                key={i}
                onRemove={() => set("work", remove(data.work, i))}
                onUp={i > 0 ? () => set("work", move(data.work, i, -1)) : undefined}
                onDown={i < data.work.length - 1 ? () => set("work", move(data.work, i, 1)) : undefined}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Job title" value={w.position} onChange={(v) => set("work", replace(data.work, i, { position: v }))} />
                  <Field label="Company" value={w.company} onChange={(v) => set("work", replace(data.work, i, { company: v }))} />
                  <Field label="Start" value={w.startDate} placeholder="2022-03" onChange={(v) => set("work", replace(data.work, i, { startDate: v }))} />
                  <Field label="End" value={w.endDate} placeholder="Present" onChange={(v) => set("work", replace(data.work, i, { endDate: v }))} />
                  <Field label="Location" value={w.location} onChange={(v) => set("work", replace(data.work, i, { location: v }))} />
                </div>
                <BulletsField label="Highlights" value={w.highlights} onChange={(v) => set("work", replace(data.work, i, { highlights: v }))} />
              </ItemCard>
            ))}
          </Section>

          <Section title="Education" onAdd={() => set("education", [...data.education, emptyEducation()])}>
            {data.education.map((e, i) => (
              <ItemCard key={i} onRemove={() => set("education", remove(data.education, i))}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Institution" value={e.institution} onChange={(v) => set("education", replace(data.education, i, { institution: v }))} />
                  <Field label="Degree" value={e.studyType} onChange={(v) => set("education", replace(data.education, i, { studyType: v }))} />
                  <Field label="Field of study" value={e.area} onChange={(v) => set("education", replace(data.education, i, { area: v }))} />
                  <Field label="Grade" value={e.score} onChange={(v) => set("education", replace(data.education, i, { score: v }))} />
                  <Field label="Start" value={e.startDate} onChange={(v) => set("education", replace(data.education, i, { startDate: v }))} />
                  <Field label="End" value={e.endDate} onChange={(v) => set("education", replace(data.education, i, { endDate: v }))} />
                </div>
              </ItemCard>
            ))}
          </Section>

          <Section title="Skills" onAdd={() => set("skills", [...data.skills, emptySkillGroup()])}>
            {data.skills.map((s, i) => (
              <ItemCard key={i} onRemove={() => set("skills", remove(data.skills, i))}>
                <Field label="Group" value={s.name} placeholder="Languages" onChange={(v) => set("skills", replace(data.skills, i, { name: v }))} />
                <Field
                  label="Skills (comma separated)"
                  value={s.keywords.join(", ")}
                  onChange={(v) => set("skills", replace(data.skills, i, { keywords: v.split(",").map((k) => k.trimStart()) }))}
                />
              </ItemCard>
            ))}
          </Section>

          <Section title="Projects" onAdd={() => set("projects", [...data.projects, emptyProject()])}>
            {data.projects.map((p, i) => (
              <ItemCard key={i} onRemove={() => set("projects", remove(data.projects, i))}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name" value={p.name} onChange={(v) => set("projects", replace(data.projects, i, { name: v }))} />
                  <Field label="URL" value={p.url} onChange={(v) => set("projects", replace(data.projects, i, { url: v }))} />
                </div>
                <Field label="Description" value={p.description} onChange={(v) => set("projects", replace(data.projects, i, { description: v }))} />
                <BulletsField label="Highlights" value={p.highlights} onChange={(v) => set("projects", replace(data.projects, i, { highlights: v }))} />
              </ItemCard>
            ))}
          </Section>

          <Section
            title="Certifications"
            onAdd={() => set("certifications", [...data.certifications, { name: "", issuer: "", date: "" }])}
          >
            {data.certifications.map((c, i) => (
              <ItemCard key={i} onRemove={() => set("certifications", remove(data.certifications, i))}>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Name" value={c.name} onChange={(v) => set("certifications", replace(data.certifications, i, { name: v }))} />
                  <Field label="Issuer" value={c.issuer} onChange={(v) => set("certifications", replace(data.certifications, i, { issuer: v }))} />
                  <Field label="Date" value={c.date} onChange={(v) => set("certifications", replace(data.certifications, i, { date: v }))} />
                </div>
              </ItemCard>
            ))}
          </Section>

          <Section title="Languages" onAdd={() => set("languages", [...data.languages, { language: "", fluency: "" }])}>
            {data.languages.map((l, i) => (
              <ItemCard key={i} onRemove={() => set("languages", remove(data.languages, i))}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Language" value={l.language} onChange={(v) => set("languages", replace(data.languages, i, { language: v }))} />
                  <Field label="Fluency" value={l.fluency} onChange={(v) => set("languages", replace(data.languages, i, { fluency: v }))} />
                </div>
              </ItemCard>
            ))}
          </Section>
        </div>

        <div className="hidden overflow-auto bg-neutral-300 p-6 lg:block">
          <div className="origin-top scale-[0.85] shadow-xl">
            <ResumePreview data={data} template={template} />
          </div>
        </div>
      </div>
    </div>
  );
}
