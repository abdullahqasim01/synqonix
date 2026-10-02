export const DEFAULT_API_URL = "http://localhost:4000";

/** Normalises a user-provided API base URL (trims whitespace and trailing slashes). */
export function normalizeApiUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  return value || DEFAULT_API_URL;
}
