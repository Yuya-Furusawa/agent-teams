import type { Task } from "../lib/types";
import { TaskListItem } from "./TaskListItem";

export function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (tasks.length === 0) {
    return (
      <div className="p-4 text-xs text-neutral-500">
        No tasks yet. Run <code className="text-neutral-300">/team &quot;...&quot;</code> in a Claude Code session to create one.
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      {tasks.map((t) => (
        <TaskListItem
          key={t.id}
          task={t}
          selected={selectedId === t.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
