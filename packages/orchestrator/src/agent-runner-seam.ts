import type { AgentRunner } from "@agent-teams/agent-runner";

/**
 * Narrow view of `AgentRunner` used by the runners in this package.
 * Tests inject fakes by structural typing — they only need to provide `run`.
 * The `exitCode: number | null` reflects the real return type of
 * `AgentRunner.run` (process may be signalled instead of exiting).
 *
 * Each runner module (planner-runner, worker-runner) holds its own module-level
 * factory so tests can set them independently. Only the types are shared here.
 */
export interface AgentRunnerLike {
  run(opts: Parameters<AgentRunner["run"]>[0]): Promise<{
    exitCode: number | null;
    parsedJson?: unknown;
    lastText: string;
  }>;
}

export type AgentRunnerFactory = () => AgentRunnerLike;
