import { z } from "zod";

// Every field is required so the schema works with Claude structured outputs.
// Unknown values are empty strings / empty arrays rather than nulls.

export const ProfileSchema = z.object({
  network: z.string().describe("e.g. LinkedIn, GitHub, Portfolio"),
  url: z.string(),
});

export const WorkSchema = z.object({
  company: z.string(),
  position: z.string(),
  location: z.string(),
  startDate: z.string().describe("YYYY-MM or YYYY; empty if unknown"),
  endDate: z.string().describe('YYYY-MM, YYYY, or "Present"; empty if unknown'),
  summary: z.string().describe("One-line role summary; empty if none"),
  highlights: z.array(z.string()).describe("Achievement bullets, verbatim where possible"),
});

export const EducationSchema = z.object({
  institution: z.string(),
  studyType: z.string().describe("Degree, e.g. BSc, MBA"),
  area: z.string().describe("Field of study"),
  startDate: z.string(),
  endDate: z.string(),
  score: z.string().describe("GPA / grade; empty if none"),
});

export const SkillGroupSchema = z.object({
  name: z.string().describe("Group name, e.g. Languages, Frameworks, Tools"),
  keywords: z.array(z.string()),
});

export const ProjectSchema = z.object({
  name: z.string(),
  url: z.string(),
  description: z.string(),
  highlights: z.array(z.string()),
});

export const CertificationSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
});

export const LanguageSchema = z.object({
  language: z.string(),
  fluency: z.string(),
});

export const ResumeSchema = z.object({
  basics: z.object({
    name: z.string(),
    label: z.string().describe("Professional headline, e.g. Senior Backend Engineer"),
    email: z.string(),
    phone: z.string(),
    location: z.string().describe("City, Country"),
    url: z.string().describe("Personal website; empty if none"),
    summary: z.string(),
    profiles: z.array(ProfileSchema),
  }),
  work: z.array(WorkSchema),
  education: z.array(EducationSchema),
  skills: z.array(SkillGroupSchema),
  projects: z.array(ProjectSchema),
  certifications: z.array(CertificationSchema),
  languages: z.array(LanguageSchema),
});

export type Resume = z.infer<typeof ResumeSchema>;
export type WorkItem = z.infer<typeof WorkSchema>;
export type EducationItem = z.infer<typeof EducationSchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type ProjectItem = z.infer<typeof ProjectSchema>;

export const emptyWork = (): WorkItem => ({
  company: "", position: "", location: "", startDate: "", endDate: "", summary: "", highlights: [""],
});
export const emptyEducation = (): EducationItem => ({
  institution: "", studyType: "", area: "", startDate: "", endDate: "", score: "",
});
export const emptySkillGroup = (): SkillGroup => ({ name: "", keywords: [] });
export const emptyProject = (): ProjectItem => ({ name: "", url: "", description: "", highlights: [] });

export const emptyResume = (): Resume => ({
  basics: { name: "", label: "", email: "", phone: "", location: "", url: "", summary: "", profiles: [] },
  work: [emptyWork()],
  education: [emptyEducation()],
  skills: [emptySkillGroup()],
  projects: [],
  certifications: [],
  languages: [],
});
