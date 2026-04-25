const SLUG_RE = /^[a-z0-9-]+$/;

export function extractSlug(markdown: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!fm) return null;
  const block = fm[1]!;
  const m = /^slug:\s*(.+?)\s*$/m.exec(block);
  if (!m) return null;
  const slug = m[1]!.replace(/^["']|["']$/g, "").trim();
  if (!SLUG_RE.test(slug) || slug.length === 0 || slug.length > 60) return null;
  return slug;
}
