export function buildWorkerAppendedSystemPrompt(
  reportPath: string,
  agentName?: string,
): string {
  const signature = agentName
    ? `Sign the report with "— ${agentName}" on its last line so the summarizer can attribute it.`
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
${signature ? `\n${signature}\n` : ""}
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
