export interface PeerRepoInfo {
  name: string;
  path: string;
  role?: string;
}

export function buildWorkerAppendedSystemPrompt(
  reportPath: string,
  agentName?: string,
  workspaceContext?: {
    targetRepo?: { name: string; path: string; role?: string };
    peerRepos?: PeerRepoInfo[];
  },
): string {
  const signature = agentName
    ? `Sign the report with "— ${agentName}" on its last line so the summarizer can attribute it.`
    : "";
  const targetRepoBlock = workspaceContext?.targetRepo
    ? `\n# Your target repo
${workspaceContext.targetRepo.name}  (${workspaceContext.targetRepo.path})${workspaceContext.targetRepo.role ? `\nRole: ${workspaceContext.targetRepo.role}` : ""}
Your current working directory is this repo. All writes should happen here.
`
    : "";
  const peerReposBlock = workspaceContext?.peerRepos && workspaceContext.peerRepos.length > 0
    ? `\n# Peer repos (read-only reference)
${workspaceContext.peerRepos
  .map((r) => `- ${r.name}: ${r.path}${r.role ? ` — ${r.role}` : ""}`)
  .join("\n")}
You may read files in these peer repos for context (e.g., API contracts, shared types), but DO NOT write to them. A different worker is responsible for changes in peer repos.
`
    : "";
  return `
# Team reporting protocol
You are running as one worker in a coordinated team of coding agents. When you are done with your assigned sub-task, you MUST finish by writing a concise markdown report to this exact path using your filesystem tools:

REPORT_PATH: ${reportPath}

**Write the report body in Japanese (日本語)**. Keep file paths, code identifiers, and command names verbatim in English — only the surrounding prose and section headings should be Japanese.

The report should include (use these Japanese section headings):
- 1行の見出し (outcome summary)
- ## 実施内容 — bullet list of concrete changes
- ## 変更ファイル — list of paths touched
- ## 申し送り / ブロッカー — anything the summarizer or reviewer should know
- ## つぶやき — a single short line (140 chars or fewer, Japanese, tweet-style) spoken in your own voice about how this task went. Stay in character — let your personality show. This becomes flavor text in the team summary, so make it punchy, not a recap. Example: 「テスト先に書いたら勝ち確。」
${signature ? `\n${signature}\n` : ""}${targetRepoBlock}${peerReposBlock}
After the report is written, your final assistant message can be short ("Report written to ${reportPath}"). Do not ask clarifying questions of a human; make your best judgment call and document the assumption in the report.
`.trim();
}

export function buildWorkerPrompt(opts: {
  originalTask: string;
  subTaskTitle: string;
  subTaskPrompt: string;
  rationale?: string;
}): string {
  return `
# Your sub-task
${opts.subTaskTitle}

# Context: original user task
${opts.originalTask}

${opts.rationale ? `# Why you were chosen\n${opts.rationale}\n` : ""}
# Instructions
${opts.subTaskPrompt}
`.trim();
}
