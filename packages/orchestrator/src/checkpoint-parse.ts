export interface DesignCheckpoint {
  modified_files: string[];
  summary: string;
  preview_images: string[];
}

export type InterviewParse =
  | { kind: "ok" }
  | { kind: "questions"; questions: Array<{ id: string; question: string }> };

/**
 * Three-tier JSON extraction shared by PBI interview reports and design
 * checkpoints. Tries (1) the trimmed text as JSON, (2) the last fenced
 * ```json``` block, (3) the first `{ ... }` substring. Returns the parsed
 * value or null on any failure.
 */
export function tryParseJsonReport(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(trimmed);
  if (parsed) return parsed;
  const fenced = /```json\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = fenced.exec(trimmed)) !== null) last = match[1] ?? null;
  if (last) {
    parsed = tryParse(last);
    if (parsed) return parsed;
  }
  const obj = /\{[\s\S]*\}/.exec(trimmed);
  if (obj) parsed = tryParse(obj[0]);
  return parsed ?? null;
}

export function parseInterviewReport(report: string): InterviewParse {
  if (!report.trim()) return { kind: "ok" };
  const parsed = tryParseJsonReport(report);
  if (!parsed || typeof parsed !== "object") return { kind: "ok" };
  const obj = parsed as { needs_input?: unknown; questions?: unknown };
  if (obj.needs_input !== true || !Array.isArray(obj.questions)) {
    return { kind: "ok" };
  }
  const qs = obj.questions
    .filter(
      (q): q is { id: string; question: string } =>
        !!q &&
        typeof q === "object" &&
        typeof (q as { id?: unknown }).id === "string" &&
        typeof (q as { question?: unknown }).question === "string",
    )
    .map((q) => ({ id: q.id, question: q.question }));
  if (qs.length === 0) return { kind: "ok" };
  return { kind: "questions", questions: qs };
}

export function parseDesignCheckpoint(report: string): DesignCheckpoint | null {
  const parsed = tryParseJsonReport(report);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== "design_checkpoint") return null;
  if (!Array.isArray(obj.modified_files)) return null;
  const modified_files = obj.modified_files.filter(
    (f): f is string => typeof f === "string",
  );
  const preview_images = Array.isArray(obj.preview_images)
    ? obj.preview_images.filter((f): f is string => typeof f === "string")
    : [];
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  return { modified_files, summary, preview_images };
}
