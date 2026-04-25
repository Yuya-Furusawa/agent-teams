export const PBI_FILENAME_REGEX = /^PBI-(\d{3,})-([a-z0-9-]+)\.md$/;
const SLUG_REGEX = /^[a-z0-9-]+$/;
const MAX_SLUG_LENGTH = 60;

export function formatPbiFilename(id: number, slug: string): string {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`invalid PBI id: ${id}`);
  }
  if (!slug || !SLUG_REGEX.test(slug) || slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`invalid PBI slug: ${JSON.stringify(slug)} (must match ${SLUG_REGEX} and be 1-${MAX_SLUG_LENGTH} chars)`);
  }
  const padded = String(id).padStart(3, "0");
  return `PBI-${padded}-${slug}.md`;
}

export function parsePbiFilename(name: string): { id: number; slug: string } | null {
  const m = PBI_FILENAME_REGEX.exec(name);
  if (!m) return null;
  return { id: parseInt(m[1]!, 10), slug: m[2]! };
}
