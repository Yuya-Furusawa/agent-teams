import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspaceRef = string;
export type PaneRef = string;
export type SurfaceRef = string;

export type SplitDirection = "left" | "right" | "up" | "down";
export type SurfaceType = "terminal" | "browser";

export interface Pane {
  ref: PaneRef;
  surfaceCount: number;
  focused: boolean;
}

export interface Surface {
  ref: SurfaceRef;
  title: string;
  selected: boolean;
}

export interface Workspace {
  ref: WorkspaceRef;
  title: string;
  selected: boolean;
}

export class CmuxError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "CmuxError";
  }
}

async function cmux(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("cmux", args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    throw new CmuxError(
      `cmux ${args.join(" ")} failed: ${e.message}`,
      args,
      e.stderr ?? "",
    );
  }
}

export async function currentWorkspace(): Promise<WorkspaceRef> {
  const out = await cmux(["current-workspace"]);
  return out.trim();
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const out = await cmux(["list-workspaces"]);
  return parseWorkspaceList(out);
}

export async function listPanes(opts: { workspace?: WorkspaceRef } = {}): Promise<Pane[]> {
  const args = ["list-panes"];
  if (opts.workspace) {
    args.push("--workspace", opts.workspace);
  }
  const out = await cmux(args);
  return parsePaneList(out);
}

export async function listPaneSurfaces(opts: {
  pane?: PaneRef;
  workspace?: WorkspaceRef;
} = {}): Promise<Surface[]> {
  const args = ["list-pane-surfaces"];
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.pane) args.push("--pane", opts.pane);
  const out = await cmux(args);
  return parseSurfaceList(out);
}

export interface NewTerminalPaneOptions {
  direction: SplitDirection;
  workspace?: WorkspaceRef;
  type?: SurfaceType;
}

export async function newTerminalPane(opts: NewTerminalPaneOptions): Promise<{
  pane: PaneRef;
  surface: SurfaceRef;
}> {
  const before = await listPanes({ workspace: opts.workspace });
  const beforeRefs = new Set(before.map((p) => p.ref));

  const args = ["new-pane", "--type", opts.type ?? "terminal", "--direction", opts.direction];
  if (opts.workspace) args.push("--workspace", opts.workspace);

  const out = await cmux(args);

  const refMatch = out.match(/pane:\d+/);
  let paneRef: PaneRef | undefined = refMatch ? refMatch[0] : undefined;
  if (!paneRef) {
    const after = await listPanes({ workspace: opts.workspace });
    const created = after.find((p) => !beforeRefs.has(p.ref));
    if (!created) {
      throw new CmuxError("could not identify newly created pane", args, "");
    }
    paneRef = created.ref;
  }

  const surfaces = await listPaneSurfaces({ pane: paneRef, workspace: opts.workspace });
  const selected = surfaces.find((s) => s.selected) ?? surfaces[0];
  if (!selected) {
    throw new CmuxError(`new pane ${paneRef} has no surfaces`, args, "");
  }
  return { pane: paneRef, surface: selected.ref };
}

export interface SendOptions {
  surface?: SurfaceRef;
  workspace?: WorkspaceRef;
  text: string;
}

export async function send(opts: SendOptions): Promise<void> {
  const args = ["send"];
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.surface) args.push("--surface", opts.surface);
  args.push(opts.text);
  await cmux(args);
}

export async function sendLine(opts: SendOptions): Promise<void> {
  await send(opts);
  await sendKey({ surface: opts.surface, workspace: opts.workspace, key: "Enter" });
}

export interface SendKeyOptions {
  surface?: SurfaceRef;
  workspace?: WorkspaceRef;
  key: string;
}

export async function sendKey(opts: SendKeyOptions): Promise<void> {
  const args = ["send-key"];
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.surface) args.push("--surface", opts.surface);
  args.push(opts.key);
  await cmux(args);
}

export interface SetStatusOptions {
  workspace?: WorkspaceRef;
  key: string;
  value: string;
  icon?: string;
  color?: string;
}

export async function setStatus(opts: SetStatusOptions): Promise<void> {
  const args = ["set-status", opts.key, opts.value];
  if (opts.icon) args.push("--icon", opts.icon);
  if (opts.color) args.push("--color", opts.color);
  if (opts.workspace) args.push("--workspace", opts.workspace);
  await cmux(args);
}

export async function clearStatus(opts: { workspace?: WorkspaceRef; key: string }): Promise<void> {
  const args = ["clear-status", opts.key];
  if (opts.workspace) args.push("--workspace", opts.workspace);
  await cmux(args);
}

export interface LogOptions {
  workspace?: WorkspaceRef;
  level?: "info" | "warn" | "error" | "debug";
  source?: string;
  message: string;
}

export async function log(opts: LogOptions): Promise<void> {
  const args = ["log"];
  if (opts.level) args.push("--level", opts.level);
  if (opts.source) args.push("--source", opts.source);
  if (opts.workspace) args.push("--workspace", opts.workspace);
  args.push("--", opts.message);
  await cmux(args);
}

export interface RenameTabOptions {
  workspace?: WorkspaceRef;
  surface?: SurfaceRef;
  title: string;
}

export async function renameTab(opts: RenameTabOptions): Promise<void> {
  const args = ["rename-tab"];
  if (opts.workspace) args.push("--workspace", opts.workspace);
  if (opts.surface) args.push("--surface", opts.surface);
  args.push(opts.title);
  await cmux(args);
}

function parsePaneList(raw: string): Pane[] {
  const panes: Pane[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const withoutLeading = trimmed.replace(/^\*\s+/, "");
    const refMatch = withoutLeading.match(/^pane:\d+/);
    if (!refMatch) continue;
    const ref = refMatch[0];
    const surfaceMatch = withoutLeading.match(/\[(\d+)\s+surface/);
    const focused = withoutLeading.includes("[focused]");
    panes.push({
      ref,
      surfaceCount: surfaceMatch && surfaceMatch[1] ? parseInt(surfaceMatch[1], 10) : 0,
      focused,
    });
  }
  return panes;
}

function parseWorkspaceList(raw: string): Workspace[] {
  const workspaces: Workspace[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const match = trimmed.match(/^[*\s]\s*(workspace:\d+)\s+(?:\S+\s+)?(.+?)(\s+\[selected\])?$/);
    if (!match || !match[1] || !match[2]) continue;
    workspaces.push({
      ref: match[1],
      title: match[2].trim(),
      selected: Boolean(match[3]),
    });
  }
  return workspaces;
}

function parseSurfaceList(raw: string): Surface[] {
  const surfaces: Surface[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const match = trimmed.match(/^[*\s]\s*(surface:\d+)\s+(?:\S+\s+)?(.+?)(\s+\[selected\])?$/);
    if (!match || !match[1] || !match[2]) continue;
    surfaces.push({
      ref: match[1],
      title: match[2].trim(),
      selected: Boolean(match[3]),
    });
  }
  return surfaces;
}
