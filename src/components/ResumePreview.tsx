import type { Resume } from "@/lib/resume-schema";
import type { Template } from "@/lib/templates";

// Pure render of a resume as a letter-size page. Shared by the editor preview and the print page.

const has = (s: string | undefined) => !!s && s.trim().length > 0;
const nonEmpty = (xs: string[]) => xs.filter(has);

function dateRange(start: string, end: string) {
  if (has(start) && has(end)) return `${start} – ${end}`;
  return start || end;
}

function Heading({ children, template }: { children: React.ReactNode; template: Template }) {
  return template === "modern" ? (
    <h2 className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">{children}</h2>
  ) : (
    <h2 className="mt-5 mb-2 border-b border-neutral-300 pb-0.5 text-[12px] font-bold uppercase tracking-wider">
      {children}
    </h2>
  );
}

export function ResumePreview({ data, template }: { data: Resume; template: Template }) {
  const { basics } = data;
  const contact = [basics.email, basics.phone, basics.location, basics.url, ...basics.profiles.map((p) => p.url)].filter(has);
  const work = data.work.filter((w) => has(w.company) || has(w.position));
  const education = data.education.filter((e) => has(e.institution));
  const skills = data.skills.filter((s) => s.keywords.length > 0);
  const projects = data.projects.filter((p) => has(p.name));
  const certs = data.certifications.filter((c) => has(c.name));
  const languages = data.languages.filter((l) => has(l.language));
  const serif = template === "classic";

  return (
    <article
      className={`resume-page mx-auto w-[8.5in] min-h-[11in] bg-white px-[0.6in] py-[0.55in] text-[10.5px] leading-[1.45] text-neutral-900 ${
        serif ? "font-serif" : "font-sans"
      }`}
    >
      <header className={serif ? "text-center" : "border-l-4 border-teal-700 pl-3"}>
        <h1 className={`font-bold ${serif ? "text-[24px] tracking-wide" : "text-[26px] tracking-tight"}`}>
          {basics.name || "Your Name"}
        </h1>
        {has(basics.label) && <p className="text-[12px] text-neutral-600">{basics.label}</p>}
        {contact.length > 0 && (
          <p className="mt-1 text-[10px] text-neutral-600">{contact.join("  ·  ")}</p>
        )}
      </header>

      {has(basics.summary) && (
        <section>
          <Heading template={template}>Summary</Heading>
          <p>{basics.summary}</p>
        </section>
      )}

      {work.length > 0 && (
        <section>
          <Heading template={template}>Experience</Heading>
          {work.map((w, i) => (
            <div key={i} className="mb-3 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-4">
                <p>
                  <span className="font-bold">{w.position}</span>
                  {has(w.company) && <span>{has(w.position) ? ", " : ""}{w.company}</span>}
                </p>
                <p className="shrink-0 text-neutral-600">{dateRange(w.startDate, w.endDate)}</p>
              </div>
              {has(w.location) && <p className="text-neutral-600">{w.location}</p>}
              {has(w.summary) && <p className="italic">{w.summary}</p>}
              {nonEmpty(w.highlights).length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {nonEmpty(w.highlights).map((h, j) => <li key={j}>{h}</li>)}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {projects.length > 0 && (
        <section>
          <Heading template={template}>Projects</Heading>
          {projects.map((p, i) => (
            <div key={i} className="mb-2 break-inside-avoid">
              <p>
                <span className="font-bold">{p.name}</span>
                {has(p.url) && <span className="text-neutral-600"> — {p.url}</span>}
              </p>
              {has(p.description) && <p>{p.description}</p>}
              {nonEmpty(p.highlights).length > 0 && (
                <ul className="list-disc pl-4">{nonEmpty(p.highlights).map((h, j) => <li key={j}>{h}</li>)}</ul>
              )}
            </div>
          ))}
        </section>
      )}

      {education.length > 0 && (
        <section>
          <Heading template={template}>Education</Heading>
          {education.map((e, i) => (
            <div key={i} className="mb-2 flex items-baseline justify-between gap-4 break-inside-avoid">
              <p>
                <span className="font-bold">{e.institution}</span>
                {(has(e.studyType) || has(e.area)) && (
                  <span> — {[e.studyType, e.area].filter(has).join(", ")}</span>
                )}
                {has(e.score) && <span className="text-neutral-600"> ({e.score})</span>}
              </p>
              <p className="shrink-0 text-neutral-600">{dateRange(e.startDate, e.endDate)}</p>
            </div>
          ))}
        </section>
      )}

      {skills.length > 0 && (
        <section>
          <Heading template={template}>Skills</Heading>
          {skills.map((s, i) => (
            <p key={i}>
              {has(s.name) && <span className="font-bold">{s.name}: </span>}
              {s.keywords.join(", ")}
            </p>
          ))}
        </section>
      )}

      {(certs.length > 0 || languages.length > 0) && (
        <section>
          <Heading template={template}>{certs.length > 0 ? "Certifications & Languages" : "Languages"}</Heading>
          {certs.map((c, i) => (
            <p key={i}>
              <span className="font-bold">{c.name}</span>
              {[c.issuer, c.date].filter(has).length > 0 && <span> — {[c.issuer, c.date].filter(has).join(", ")}</span>}
            </p>
          ))}
          {languages.length > 0 && (
            <p>{languages.map((l) => (has(l.fluency) ? `${l.language} (${l.fluency})` : l.language)).join(", ")}</p>
          )}
        </section>
      )}
    </article>
  );
}
