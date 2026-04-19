#!/usr/bin/env bash
#
# agent-teams setup
#   - installs workspace dependencies (pnpm)
#   - builds all packages
#   - exposes the `agent-teams` binary on PATH
#   - links commands/team.md into ~/.claude/commands/
#   - creates ~/.agent-teams/ for task history
#
# Usage:
#   ./setup.sh              # interactive (prompts before overwriting existing files)
#   ./setup.sh --yes        # non-interactive, overwrite existing symlinks
#   ./setup.sh --dry-run    # print actions without performing them
#   ./setup.sh --with-gui   # also build the Tauri desktop GUI into dist-gui/
#
set -euo pipefail

DRY_RUN=0
YES=0
WITH_GUI=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes|-y)  YES=1 ;;
    --with-gui) WITH_GUI=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_COMMANDS_DIR="${CLAUDE_COMMANDS_DIR:-$HOME/.claude/commands}"
AGENT_TEAMS_HOME="${AGENT_TEAMS_HOME:-$HOME/.agent-teams}"
AGENT_TEAMS_BIN_DIR="${AGENT_TEAMS_BIN_DIR:-$HOME/.local/bin}"

step() { printf "\n==> %s\n" "$1"; }
run()  { if [[ $DRY_RUN -eq 1 ]]; then echo "+ $*"; else eval "$@"; fi; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' not found on PATH" >&2; exit 1; }
}

step "checking prerequisites"
require node
require pnpm
require claude
# cmux is optional — if present, the orchestrator emits workspace status/log events;
# if absent, those calls are skipped silently.

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "error: node >= 20 required (found $(node --version))" >&2
  exit 1
fi

step "installing dependencies"
run "cd \"$REPO_ROOT\" && pnpm install"

step "building packages"
run "cd \"$REPO_ROOT\" && pnpm -r build"

if [[ $WITH_GUI -eq 1 ]]; then
  step "building Tauri GUI"
  run "cd \"$REPO_ROOT\" && pnpm --filter @agent-teams/gui tauri build"
  if [[ -d "$REPO_ROOT/packages/gui/src-tauri/target/release/bundle" ]]; then
    run "mkdir -p \"$REPO_ROOT/dist-gui\""
    run "cp -R \"$REPO_ROOT/packages/gui/src-tauri/target/release/bundle\"/* \"$REPO_ROOT/dist-gui\"/"
  else
    echo "warning: tauri bundle directory missing — skipping copy" >&2
  fi
fi

step "marking CLI binary executable"
run "chmod +x \"$REPO_ROOT/packages/cli/dist/index.js\""

step "linking CLI into $AGENT_TEAMS_BIN_DIR"
run "mkdir -p \"$AGENT_TEAMS_BIN_DIR\""
link_bin() {
  local target="$1" name="$2"
  local link="$AGENT_TEAMS_BIN_DIR/$name"
  if [[ -e "$link" || -L "$link" ]]; then
    if [[ $YES -eq 1 || $DRY_RUN -eq 1 ]]; then
      run "rm -f \"$link\""
    else
      printf "    %s already exists. overwrite? [y/N] " "$link"
      read -r ans
      case "$ans" in
        y|Y) run "rm -f \"$link\"" ;;
        *)   echo "    skipped"; return 0 ;;
      esac
    fi
  fi
  run "ln -s \"$target\" \"$link\""
}
link_bin "$REPO_ROOT/packages/cli/dist/index.js" "agent-teams"

step "linking slash commands into $CLAUDE_COMMANDS_DIR"
run "mkdir -p \"$CLAUDE_COMMANDS_DIR\""
link_command() {
  local source="$1" name="$2"
  local target="$CLAUDE_COMMANDS_DIR/$name"
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ $YES -eq 1 || $DRY_RUN -eq 1 ]]; then
      run "rm -f \"$target\""
    else
      printf "    %s already exists. overwrite? [y/N] " "$target"
      read -r ans
      case "$ans" in
        y|Y) run "rm -f \"$target\"" ;;
        *)   echo "    skipped"; return 0 ;;
      esac
    fi
  fi
  run "ln -s \"$source\" \"$target\""
}
link_command "$REPO_ROOT/commands/team.md" "team.md"
link_command "$REPO_ROOT/commands/team-ws.md" "team-ws.md"

step "creating data directories"
run "mkdir -p \"$AGENT_TEAMS_HOME/tasks\""
run "mkdir -p \"$AGENT_TEAMS_HOME/workspaces\""

PATH_WARNING=""
case ":$PATH:" in
  *":$AGENT_TEAMS_BIN_DIR:"*) ;;
  *) PATH_WARNING="

note: $AGENT_TEAMS_BIN_DIR is not on your PATH. Add this line to your shell rc (~/.zshrc or ~/.bashrc) and restart the shell:
    export PATH=\"$AGENT_TEAMS_BIN_DIR:\$PATH\"
" ;;
esac

cat <<EOF

done.

usage:
  cd <your-repo>
  cp $REPO_ROOT/agent-team.yaml .    # edit the roster if needed
  # inside Claude Code:
  /team "<your task>"

data directory:   $AGENT_TEAMS_HOME
workspaces:       $AGENT_TEAMS_HOME/workspaces/
slash commands:   $CLAUDE_COMMANDS_DIR/team.md, $CLAUDE_COMMANDS_DIR/team-ws.md
cli linked at:    $AGENT_TEAMS_BIN_DIR/agent-teams$PATH_WARNING
EOF
