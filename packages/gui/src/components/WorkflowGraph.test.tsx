import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WorkflowGraph } from "./WorkflowGraph";
import type { WorkflowGraph as WorkflowGraphData } from "../lib/types";

function mkGraph(subs: { id: string; status: "pending" | "running" | "completed" | "failed"; agent?: string }[]): WorkflowGraphData {
  return {
    detail: {
      task: {
        id: "t1",
        description: "",
        teamName: "default",
        status: "running",
        createdAt: 0,
        completedAt: null,
        subTaskCount: subs.length,
        completedSubTaskCount: subs.filter((s) => s.status === "completed").length,
        failedSubTaskCount: subs.filter((s) => s.status === "failed").length,
        workspace: null,
      },
      subTasks: subs.map((s) => ({
        id: s.id,
        taskId: "t1",
        title: `job ${s.id}`,
        assignedAgent: s.agent ?? "Kai",
        status: s.status,
        createdAt: 0,
        completedAt: null,
        targetRepo: null,
        dependsOn: [],
      })),
      effectiveStatus: "running",
    },
    artifacts: {
      summaryExists: false,
      plannerEventsExists: false,
      triageEventsExists: false,
    },
  };
}

describe("WorkflowGraph", () => {
  it("fires summary ReportKind when the Summary node is clicked", () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <WorkflowGraph
        graph={mkGraph([{ id: "s1", status: "completed" }])}
        selected={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(getByText("Summary"));
    expect(onSelect).toHaveBeenCalledWith("summary");
  });

  it("fires subTask ReportKind when a worker node is clicked", () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <WorkflowGraph
        graph={mkGraph([{ id: "sA", status: "running", agent: "Kai" }])}
        selected={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(getByText("job sA"));
    expect(onSelect).toHaveBeenCalledWith({ subTask: "sA" });
  });

  it("fires plannerEvents when the Planning node is clicked", () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <WorkflowGraph
        graph={mkGraph([])}
        selected={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(getByText("Planning"));
    expect(onSelect).toHaveBeenCalledWith("plannerEvents");
  });

  it("renders worker progress count in header", () => {
    const { container } = render(
      <WorkflowGraph
        graph={mkGraph([
          { id: "s1", status: "completed" },
          { id: "s2", status: "running" },
          { id: "s3", status: "pending" },
        ])}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(container.textContent).toContain("Workers 1/3");
    expect(container.textContent).toContain("1 running");
  });
});
