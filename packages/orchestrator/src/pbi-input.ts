const RE_BARE = /^(\d+)$/;
const RE_PREFIX = /^PBI-(\d+)$/i;

export function parsePbiNumber(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  const m1 = RE_BARE.exec(t);
  if (m1) return parseInt(m1[1]!, 10);
  const m2 = RE_PREFIX.exec(t);
  if (m2) return parseInt(m2[1]!, 10);
  return null;
}

export function buildPbiTaskDescription(pbiId: number, pbiMarkdown: string): string {
  const padded = String(pbiId).padStart(3, "0");
  return `[PBI-${padded}] 以下の Product Backlog Item を実装してください。\n\n${pbiMarkdown}`;
}
