import type { SubTask } from "../lib/types";
import { StatusBadge } from "./StatusBadge";

interface ParsedEvent {
  type: string;
  preview: string;
}

function parseEvents(raw: string | null): ParsedEvent[] {
  if (!raw) return [];
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: ParsedEvent[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const type = typeof obj.type === "string" ? obj.type : "event";
      let preview = "";
      if (type === "assistant" && obj.message?.content) {
        const content = obj.message.content;
        if (Array.isArray(content)) {
          const text = content.find((c: { type?: string }) => c?.type === "text");
          if (text && typeof text.text === "string") {
            preview = text.text.replace(/\s+/g, " ").slice(0, 160);
          } else {
            const tool = content.find((c: { type?: string }) => c?.type === "tool_use");
            if (tool) preview = `tool_use: ${tool.name ?? ""}`;
          }
        }
      } else if (type === "result" && typeof obj.result === "string") {
        preview = obj.result.replace(/\s+/g, " ").slice(0, 160);
      } else if (type === "user" && typeof obj.message?.content === "string") {
        preview = obj.message.content.replace(/\s+/g, " ").slice(0, 160);
      }
      out.push({ type, preview });
    } catch {
      // Ignore malformed lines; planner-events.jsonl is append-only and can be truncated mid-write.
    }
  }
  return out;
}

export function PlanningView({
  subTasks,
  events,
}: {
  subTasks: SubTask[];
  events: string | null;
}): JSX.Element {
  const parsed = parseEvents(events);
  return (
    <div className="h-full overflow-y-auto px-4 py-3 text-sm space-y-5">
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
          Sub-tasks ({subTasks.length})
        </h3>
        {subTasks.length === 0 ? (
          <p className="text-neutral-500 text-xs">No sub-tasks planned yet.</p>
        ) : (
          <ol className="space-y-2">
            {subTasks.map((s, i) => (
              <li
                key={s.id}
                className="rounded border border-neutral-800 bg-neutral-900 p-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-neutral-500 text-xs">{i + 1}.</span>
                  <span className="font-medium">{s.assignedAgent}</span>
                  {s.targetRepo && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-neutral-700 text-neutral-200">
                      {s.targetRepo}
                    </span>
                  )}
                  <span className="ml-auto"><StatusBadge status={s.status} /></span>
                </div>
                <div className="text-neutral-400 text-xs mt-1">{s.title}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
          Planner events ({parsed.length})
        </h3>
        {parsed.length === 0 ? (
          <p className="text-neutral-500 text-xs">Planner events not available.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {parsed.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-neutral-500 shrink-0 w-20 truncate">{e.type}</span>
                <span className="text-neutral-300 truncate">{e.preview || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
