export function buildWorkerAppendedSystemPrompt(reportPath: string): string {
  return `
# Team reporting protocol
You are running as one worker in a coordinated team of coding agents. When you are done with your assigned sub-task, you MUST finish by writing a concise markdown report to this exact path using your filesystem tools:

REPORT_PATH: ${reportPath}

The report should include:
- A one-line headline describing the outcome
- "What was done" (bullet list of concrete changes)
- "Files touched" (paths)
- "Follow-ups / blockers" (anything the summarizer or reviewer should know)

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
