export const TEMPLATES = ["classic", "modern"] as const;
export type Template = (typeof TEMPLATES)[number];
