import type { EffectiveTaskStatus, SubTaskStatus } from "../lib/types";

type Status = EffectiveTaskStatus | SubTaskStatus;

const MAP: Record<Status, { label: string; className: string }> = {
  planning:  { label: "planning",  className: "text-neutral-400" },
  pending:   { label: "pending",   className: "text-neutral-400" },
  running:   { label: "running",   className: "text-warn" },
  completed: { label: "done",      className: "text-ok" },
  failed:    { label: "failed",    className: "text-bad" },
  partial:   { label: "partial",   className: "text-warn" },
};

export function StatusBadge({ status }: { status: Status }): JSX.Element {
  const { label, className } = MAP[status];
  return (
    <span className={`text-xs uppercase tracking-wide ${className}`}>{label}</span>
  );
}
