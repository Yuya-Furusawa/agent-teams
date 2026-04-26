import { describe, expect, it } from "vitest";
import { runDag } from "./orchestrator.js";

describe("runDag preCompletedIds", () => {
  it("treats pre-completed deps as satisfied so dependents can start", async () => {
    const calls: string[] = [];
    // Two nodes; only B is in `nodes`. B depends on A which is pre-completed.
    await runDag(
      [{ id: "B", dependsOn: ["A"], item: "B" }],
      2,
      async (item) => { calls.push(item); },
      { preCompletedIds: new Set(["A"]) },
    );
    expect(calls).toEqual(["B"]);
  });

  it("without preCompletedIds, missing dep causes deadlock error", async () => {
    await expect(
      runDag(
        [{ id: "B", dependsOn: ["A"], item: "B" }],
        2,
        async () => {},
      ),
    ).rejects.toThrow(/deadlocked/);
  });

  it("preCompletedIds defaults to empty set (back-compat: 3-arg form still works)", async () => {
    const calls: string[] = [];
    await runDag(
      [{ id: "A", dependsOn: [], item: "A" }, { id: "B", dependsOn: ["A"], item: "B" }],
      2,
      async (item) => { calls.push(item); },
    );
    expect(calls.sort()).toEqual(["A", "B"]);
  });
});
