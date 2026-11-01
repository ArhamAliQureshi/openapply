import { z } from "zod";

// Facts used to fill application forms. Everything here is the candidate's own data;
// the filler never invents values that are not in the profile or the answer library.

const WorkAuthorizationSchema = z.object({
  country: z.string().describe("e.g. United States, United Kingdom, Germany"),
  authorized: z.boolean(),
  needsSponsorship: z.boolean(),
});

const EeoSchema = z.object({
  // Empty string = decline to answer.
  gender: z.string(),
  race: z.string(),
  hispanic: z.string(),
  veteran: z.string(),
  disability: z.string(),
});

export const FeedPreferencesSchema = z.object({
  titles: z.array(z.string()),
  locations: z.array(z.string()),
  remoteOk: z.boolean(),
  onsiteOk: z.boolean(),
  excludeCompanies: z.array(z.string()),
  excludeKeywords: z.array(z.string()),
  maxAgeDays: z.number().int().min(1).max(365),
});

export const AutopilotSchema = z.object({
  enabled: z.boolean(),
  // "dry_run" fills forms without submitting; "live" submits (also needs ALLOW_LIVE_SUBMIT=true).
  mode: z.enum(["dry_run", "live"]),
  dailyLimit: z.number().int().min(1).max(200),
  minScore: z.number().int().min(0).max(100),
  // Local hour (0–23) after which the daily run may start.
  runAfterHour: z.number().int().min(0).max(23),
});

export const ProfileSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string(),
  email: z.string(),
  phone: z.string(),
  phoneCountry: z.string().describe("Country for the phone prefix, e.g. United States"),
  location: z.string().describe("City, region/country, e.g. San Francisco, CA"),
  country: z.string(),
  linkedin: z.string(),
  github: z.string(),
  website: z.string(),
  currentCompany: z.string(),
  currentTitle: z.string(),
  workAuthorizations: z.array(WorkAuthorizationSchema),
  // Companies you have worked for (employee or contractor). Answers "Have you worked for X before?".
  pastEmployers: z.array(z.string()),
  citizenships: z.array(z.string()),
  // e.g. "None", "Secret", "Top Secret". Empty = unknown (asks you).
  securityClearance: z.string(),
  // Auto-accept standard certifications and consents ("I certify my information is correct",
  // AI interview transcription, arbitration agreements). Off by default: these are legal agreements.
  autoAcceptAttestations: z.boolean(),
  willingToRelocate: z.boolean(),
  over18: z.boolean(),
  salaryExpectation: z.string(),
  noticePeriod: z.string(),
  howDidYouHear: z.string(),
  eeo: EeoSchema,
  // Let the AI write answers to free-text questions such as "Why do you want to work here?".
  aiWrittenAnswers: z.boolean(),
  // Short background the AI uses when writing free-text answers.
  aboutMe: z.string(),
  resumeFile: z.object({ path: z.string(), filename: z.string() }).nullable(),
  feed: FeedPreferencesSchema,
  autopilot: AutopilotSchema,
});

export type Profile = z.infer<typeof ProfileSchema>;
export type WorkAuthorization = z.infer<typeof WorkAuthorizationSchema>;
export type Autopilot = z.infer<typeof AutopilotSchema>;

export const emptyProfile = (): Profile => ({
  firstName: "",
  lastName: "",
  preferredName: "",
  email: "",
  phone: "",
  phoneCountry: "",
  location: "",
  country: "",
  linkedin: "",
  github: "",
  website: "",
  currentCompany: "",
  currentTitle: "",
  workAuthorizations: [],
  pastEmployers: [],
  citizenships: [],
  securityClearance: "",
  autoAcceptAttestations: false,
  willingToRelocate: false,
  over18: true,
  salaryExpectation: "",
  noticePeriod: "",
  howDidYouHear: "Company careers page",
  eeo: { gender: "", race: "", hispanic: "", veteran: "", disability: "" },
  aiWrittenAnswers: true,
  aboutMe: "",
  resumeFile: null,
  feed: {
    titles: [],
    locations: [],
    remoteOk: true,
    onsiteOk: true,
    excludeCompanies: [],
    excludeKeywords: ["intern"],
    maxAgeDays: 14,
  },
  autopilot: { enabled: false, mode: "dry_run", dailyLimit: 20, minScore: 75, runAfterHour: 9 },
});
