import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export type StreamJsonEvent = {
  type: string;
  [key: string]: unknown;
};

export interface RunAgentOptions {
  agent: string;
  prompt: string;
  cwd: string;
  settingsPath?: string;
  appendSystemPrompt?: string;
  systemPrompt?: string;
  jsonSchema?: unknown;
  model?: string;
  permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
  allowedTools?: string[];
  addDirs?: string[];
  includeHookEvents?: boolean;
  claudeBinary?: string;
  onEvent?: (event: StreamJsonEvent) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunAgentResult {
  exitCode: number | null;
  events: StreamJsonEvent[];
  lastText: string;
  parsedJson: unknown | null;
  pid: number | null;
}

export class AgentRunner extends EventEmitter {
  async run(opts: RunAgentOptions): Promise<RunAgentResult> {
    const bin = opts.claudeBinary ?? "claude";
    const args: string[] = [
      "-p",
      opts.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--agent",
      opts.agent,
    ];
    if (opts.includeHookEvents ?? true) {
      args.push("--include-hook-events");
    }
    if (opts.model) args.push("--model", opts.model);
    if (opts.settingsPath) args.push("--settings", opts.settingsPath);
    if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt);
    if (opts.appendSystemPrompt) {
      args.push("--append-system-prompt", opts.appendSystemPrompt);
    }
    if (opts.jsonSchema) {
      args.push("--json-schema", JSON.stringify(opts.jsonSchema));
    }
    if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);
    if (opts.allowedTools && opts.allowedTools.length > 0) {
      args.push("--allowed-tools", ...opts.allowedTools);
    }
    if (opts.addDirs && opts.addDirs.length > 0) {
      args.push("--add-dir", ...opts.addDirs);
    }

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const events: StreamJsonEvent[] = [];
    let lastText = "";
    let parsedJson: unknown | null = null;
    let buffer = "";

    const handleStdout = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        let event: StreamJsonEvent;
        try {
          event = JSON.parse(line) as StreamJsonEvent;
        } catch {
          continue;
        }
        events.push(event);
        this.emit("event", event);
        if (opts.onEvent) opts.onEvent(event);
        const text = extractAssistantText(event);
        if (text) lastText = text;
        const json = extractResultJson(event);
        if (json !== undefined) parsedJson = json;
      }
    };

    child.stdout.on("data", handleStdout);
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (opts.onStderr) opts.onStderr(text);
      this.emit("stderr", text);
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code));
    });

    if (buffer.trim().length > 0) {
      try {
        const event = JSON.parse(buffer) as StreamJsonEvent;
        events.push(event);
        this.emit("event", event);
        if (opts.onEvent) opts.onEvent(event);
      } catch {
        // discard trailing garbage
      }
    }

    if (parsedJson === null) {
      parsedJson = extractFencedJson(lastText);
    }

    return {
      exitCode,
      events,
      lastText,
      parsedJson,
      pid: child.pid ?? null,
    };
  }
}

function extractFencedJson(text: string): unknown | null {
  if (!text) return null;
  const fenceRe = /```(?:json)?\s*\n([\s\S]*?)```/gi;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m[1]) candidates.push(m[1]);
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i]!);
    } catch {
      continue;
    }
  }
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  return null;
}

function extractAssistantText(event: StreamJsonEvent): string | null {
  if (event["type"] !== "assistant") return null;
  const message = event["message"] as { content?: Array<{ type: string; text?: string }> } | undefined;
  if (!message?.content) return null;
  const texts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

function extractResultJson(event: StreamJsonEvent): unknown | undefined {
  if (event["type"] !== "result") return undefined;
  const result = event["result"];
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return undefined;
    }
  }
  if (result !== undefined) return result;
  return undefined;
}
