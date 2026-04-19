import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskList } from "./TaskList";
import type { Task } from "../lib/types";

const baseTask: Task = {
  id: "t1",
  description: "fix readme",
  teamName: "default",
  status: "completed",
  createdAt: Date.now() - 120_000,
  completedAt: Date.now(),
  subTaskCount: 1,
  completedSubTaskCount: 1,
  failedSubTaskCount: 0,
};

describe("TaskList", () => {
  it("renders a hint when empty", () => {
    render(<TaskList tasks={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByText(/No tasks yet/)).toBeTruthy();
  });

  it("calls onSelect with the clicked task id", () => {
    const onSelect = vi.fn();
    render(<TaskList tasks={[baseTask]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("fix readme"));
    expect(onSelect).toHaveBeenCalledWith("t1");
  });

  it("marks the selected row with a background class", () => {
    const { container } = render(
      <TaskList tasks={[baseTask]} selectedId="t1" onSelect={() => {}} />,
    );
    expect(container.querySelector(".bg-neutral-800")).not.toBeNull();
  });
});
