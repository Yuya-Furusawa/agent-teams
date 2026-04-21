import { AgentRunner, type InlineAgentDefinition, type StreamJsonEvent } from "@agent-teams/agent-runner";
import {
  appendEvent,
  initAgentDir,
  readReport,
  reportFile,
  writeReport,
  Storage,
} from "@agent-teams/storage";
import {
  buildWorkerAppendedSystemPrompt,
  buildWorkerPrompt,
  type PeerRepoInfo,
} from "./worker-contract.js";

interface AgentRunnerLike {
  run(opts: Parameters<AgentRunner["run"]>[0]): Promise<{
    exitCode: number | null;
    parsedJson?: unknown;
    lastText: string;
  }>;
}
type AgentRunnerFactory = () => AgentRunnerLike;

let agentRunnerFactory: AgentRunnerFactory = () => new AgentRunner();

export function __setAgentRunnerFactoryForTests(
  factory: AgentRunnerFactory | null,
): void {
  agentRunnerFactory = factory ?? (() => new AgentRunner());
}

export interface WorkerRunParams {
  taskId: string;
  subTaskId: string;
  agent: string;
  originalTask: string;
  subTaskTitle: string;
  subTaskPrompt: string;
  rationale?: string;
  cwd: string;
  model?: string;
  inlineAgents: Record<string, InlineAgentDefinition>;
  targetRepo?: { name: string; path: string; role?: string };
  peerRepos?: PeerRepoInfo[];
}

export async function runWorker(params: WorkerRunParams): Promise<{
  exitCode: number | null;
  reportPath: string;
}> {
  const storage = new Storage();
  try {
    initAgentDir(params.taskId, params.subTaskId);
    const path = reportFile(params.taskId, params.subTaskId);

    const prompt = buildWorkerPrompt({
      originalTask: params.originalTask,
      subTaskTitle: params.subTaskTitle,
      subTaskPrompt: params.subTaskPrompt,
      rationale: params.rationale,
    });

    const runner = agentRunnerFactory();
    const result = await runner.run({
      agent: params.agent,
      prompt,
      cwd: params.cwd,
      appendSystemPrompt: buildWorkerAppendedSystemPrompt(path, params.agent, {
        ...(params.targetRepo ? { targetRepo: params.targetRepo } : {}),
        ...(params.peerRepos ? { peerRepos: params.peerRepos } : {}),
      }),
      includeHookEvents: true,
      permissionMode: "bypassPermissions",
      model: params.model,
      inlineAgents: params.inlineAgents,
      onEvent: (event: StreamJsonEvent) => {
        appendEvent(params.taskId, params.subTaskId, event);
      },
    });

    const existing = readReport(params.taskId, params.subTaskId);
    if (!existing) {
      const fallback = result.lastText || "(worker produced no final report)";
      writeReport(params.taskId, params.subTaskId, fallback);
    }

    const status = result.exitCode === 0 ? "completed" : "failed";
    storage.updateSubTaskStatus(params.subTaskId, status, Date.now());
    return { exitCode: result.exitCode, reportPath: path };
  } finally {
    storage.close();
  }
}
