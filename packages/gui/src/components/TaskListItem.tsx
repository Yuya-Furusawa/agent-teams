import type { Task } from "../lib/types";
import { StatusBadge } from "./StatusBadge";
import { relativeTime } from "../lib/time";

export function TaskListItem({
  task,
  selected,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const progress =
    task.subTaskCount > 0
      ? `${task.completedSubTaskCount}/${task.subTaskCount}`
      : "";
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      className={`w-full text-left px-3 py-2 border-b border-neutral-800 ${
        selected ? "bg-neutral-800" : "hover:bg-neutral-900"
      }`}
    >
      <div className="text-sm text-neutral-100 truncate">
        {task.workspace && (
          <span className="text-[10px] px-1 py-0.5 mr-1.5 rounded bg-neutral-700 text-neutral-200 align-middle">
            {task.workspace}
          </span>
        )}
        {task.description}
      </div>
      <div className="flex items-center gap-2 text-xs mt-1">
        <StatusBadge status={task.status} />
        {progress && <span className="text-neutral-500">{progress}</span>}
        <span className="text-neutral-600 ml-auto">
          {relativeTime(task.createdAt)}
        </span>
      </div>
    </button>
  );
}
