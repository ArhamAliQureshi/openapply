// ATS-neutral description of an application form and the plan for filling it.

export type FieldKind =
  | "text"
  | "textarea"
  | "select" // single choice from options
  | "multiselect"
  | "file"
  | "location" // autocomplete location picker
  | "hidden";

export type FormField = {
  id: string; // DOM id / ATS field name
  label: string;
  // Extra question text some forms put under a short heading (e.g. "U.S. WORK AUTHORIZATION").
  description?: string;
  kind: FieldKind;
  required: boolean;
  options: { label: string; decline?: boolean }[];
  group: "standard" | "custom" | "eeo";
};

export type AnswerSource = "profile" | "library" | "rule" | "ai" | "default";

export type PlannedAnswer = {
  fieldId: string;
  label: string;
  kind: FieldKind;
  value: string | string[]; // option label(s), text, or file path
  source: AnswerSource;
};

export type MissingAnswer = {
  fieldId: string;
  label: string; // the form's own label (also the answer-library key)
  detail?: string; // extra question text shown under the label
  kind: FieldKind;
  required: boolean;
  options: string[];
  reason: string;
};

export type ApplicationPlan = {
  answers: PlannedAnswer[];
  missing: MissingAnswer[]; // required questions we could not answer
  skipped: { fieldId: string; label: string }[]; // optional questions left blank
};
