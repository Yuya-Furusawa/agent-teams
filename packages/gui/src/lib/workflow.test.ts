import { describe, expect, it } from "vitest";
import {
  deriveWorkflow,
  layoutWorkflow,
  stageToReportKind,
  workflowProgress,
} from "./workflow";
import type { SubTask, SubTaskStatus, TaskStatus, WorkflowGraph } from "./types";

function mkSub(
  id: string,
  status: SubTaskStatus,
  agent = "Kai",
  title = "do thing",
  dependsOn: string[] = [],
): SubTask {
  return {
    id,
    taskId: "t1",
    title,
    assignedAgent: agent,
    status,
    createdAt: 0,
    completedAt: null,
    targetRepo: null,
    dependsOn,
  };
}

function mkGraph(
  taskStatus: TaskStatus,
  subs: SubTask[],
  artifacts: Partial<WorkflowGraph["artifacts"]> = {},
): WorkflowGraph {
  return {
    detail: {
      task: {
        id: "t1",
        description: "",
        teamName: "default",
        status: taskStatus,
        createdAt: 0,
        completedAt: null,
        subTaskCount: subs.length,
        completedSubTaskCount: subs.filter((s) => s.status === "completed").length,
        failedSubTaskCount: subs.filter((s) => s.status === "failed").length,
        workspace: null,
      },
      subTasks: subs,
      effectiveStatus: taskStatus,
    },
    artifacts: {
      summaryExists: false,
      plannerEventsExists: false,
      triageEventsExists: false,
      ...artifacts,
    },
  };
}

describe("deriveWorkflow", () => {
  it("plans running and summary pending while task is in planning", () => {
    const stages = deriveWorkflow(mkGraph("planning", []));
    expect(stages).toHaveLength(2);
    expect(stages[0].kind).toBe("planning");
    expect(stages[0].status).toBe("running");
    expect(stages[1].kind).toBe("summary");
    expect(stages[1].status).toBe("pending");
  });

  it("marks planning completed once sub-tasks exist", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [mkSub("s1", "running"), mkSub("s2", "pending")]),
    );
    expect(stages[0].status).toBe("completed");
    const workers = stages.filter((s) => s.kind === "workers");
    expect(workers).toHaveLength(2);
    expect(workers[0].status).toBe("running");
    expect(workers[1].status).toBe("pending");
  });

  it("summary becomes running when all workers are terminal but task still running", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [mkSub("s1", "completed"), mkSub("s2", "failed")]),
    );
    const summary = stages.find((s) => s.kind === "summary")!;
    expect(summary.status).toBe("running");
  });

  it("summary completed when summary.md exists", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [mkSub("s1", "completed")], { summaryExists: true }),
    );
    expect(stages.at(-1)!.status).toBe("completed");
  });

  it("summary completed when task completed", () => {
    const stages = deriveWorkflow(
      mkGraph("completed", [mkSub("s1", "completed")]),
    );
    expect(stages.at(-1)!.status).toBe("completed");
  });

  it("propagates target repo on worker stages", () => {
    const s = mkSub("s1", "running");
    s.targetRepo = "backend";
    const stages = deriveWorkflow(mkGraph("running", [s]));
    const worker = stages.find((x) => x.kind === "workers")!;
    expect(worker.targetRepo).toBe("backend");
  });
});

describe("stageToReportKind", () => {
  it("routes planning to plannerEvents", () => {
    const [planning] = deriveWorkflow(mkGraph("planning", []));
    expect(stageToReportKind(planning)).toBe("plannerEvents");
  });

  it("routes summary to summary", () => {
    const stages = deriveWorkflow(mkGraph("completed", [mkSub("s1", "completed")]));
    expect(stageToReportKind(stages.at(-1)!)).toBe("summary");
  });

  it("routes worker to subTask kind", () => {
    const stages = deriveWorkflow(mkGraph("running", [mkSub("s1", "running")]));
    const worker = stages.find((s) => s.kind === "workers")!;
    expect(stageToReportKind(worker)).toEqual({ subTask: "s1" });
  });
});

describe("layoutWorkflow", () => {
  it.each([0, 1, 3, 8])("produces expected node count for %d workers (no deps)", (n) => {
    const subs = Array.from({ length: n }, (_, i) => mkSub(`s${i}`, "pending"));
    const stages = deriveWorkflow(mkGraph("running", subs));
    const layout = layoutWorkflow(stages);
    expect(layout.nodes).toHaveLength(n + 2);
    expect(layout.edges).toHaveLength(n === 0 ? 1 : n * 2);
  });

  it("keeps 3 distinct rows when all workers are independent", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [mkSub("s1", "running"), mkSub("s2", "running")]),
    );
    const { nodes } = layoutWorkflow(stages);
    const ys = new Set(nodes.map((n) => n.y));
    expect(ys.size).toBe(3);
  });

  it("places a dependent worker on a row below its dependency", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [
        mkSub("impl", "completed", "Kai"),
        mkSub("review", "pending", "Iris", "review", ["impl"]),
      ]),
    );
    const { nodes } = layoutWorkflow(stages);
    const impl = nodes.find((n) => n.id === "worker-impl")!;
    const review = nodes.find((n) => n.id === "worker-review")!;
    expect(review.y).toBeGreaterThan(impl.y);
  });

  it("puts two reviewers with shared dependency on the same row (parallel)", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [
        mkSub("impl", "completed", "Kai"),
        mkSub("rev1", "pending", "Iris", "code review", ["impl"]),
        mkSub("rev2", "pending", "Quinn", "qa", ["impl"]),
      ]),
    );
    const { nodes, edges } = layoutWorkflow(stages);
    const rev1 = nodes.find((n) => n.id === "worker-rev1")!;
    const rev2 = nodes.find((n) => n.id === "worker-rev2")!;
    expect(rev1.y).toBe(rev2.y);
    // Both reviewers depend on impl
    const toRev1 = edges.find((e) => e.toId === "worker-rev1")!;
    const toRev2 = edges.find((e) => e.toId === "worker-rev2")!;
    expect(toRev1.fromId).toBe("worker-impl");
    expect(toRev2.fromId).toBe("worker-impl");
  });

  it("chains reviewers across layers when one depends on another", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [
        mkSub("impl", "completed", "Kai"),
        mkSub("rev1", "completed", "Iris", "first review", ["impl"]),
        mkSub("rev2", "pending", "Iris", "senior review", ["impl", "rev1"]),
      ]),
    );
    const { nodes } = layoutWorkflow(stages);
    const impl = nodes.find((n) => n.id === "worker-impl")!;
    const rev1 = nodes.find((n) => n.id === "worker-rev1")!;
    const rev2 = nodes.find((n) => n.id === "worker-rev2")!;
    expect(rev1.y).toBeGreaterThan(impl.y);
    expect(rev2.y).toBeGreaterThan(rev1.y);
  });

  it("only sink workers feed into Summary", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [
        mkSub("impl", "completed", "Kai"),
        mkSub("review", "pending", "Iris", "review", ["impl"]),
      ]),
    );
    const { edges } = layoutWorkflow(stages);
    const toSummary = edges.filter((e) => e.toId === "summary");
    expect(toSummary).toHaveLength(1);
    expect(toSummary[0]!.fromId).toBe("worker-review");
  });
});

describe("workflowProgress", () => {
  it("counts worker statuses", () => {
    const stages = deriveWorkflow(
      mkGraph("running", [
        mkSub("s1", "completed"),
        mkSub("s2", "running"),
        mkSub("s3", "failed"),
        mkSub("s4", "pending"),
      ]),
    );
    expect(workflowProgress(stages)).toEqual({
      total: 4,
      completed: 1,
      running: 1,
      failed: 1,
    });
  });
});
