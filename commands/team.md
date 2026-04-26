---
description: Dispatch a coding task to the agent-teams orchestrator (also resumes interrupted tasks when asked: "実装を再開して" / "続きをやって" / "resume")
argument-hint: <natural-language task description | PBI number | "resume">
allowed-tools: Bash(agent-teams:*), Read
---

Run the agent-teams orchestrator for this task. It will spawn a planner and worker Claude Code agents in-process, then produce a summary report.

引数として PBI 番号（例: `42` や `PBI-42`）を渡すと、設定済み Obsidian Vault から該当 PBI を読み込んで実装フェーズに乗せます。

If the user is asking to resume a previously-interrupted task (phrases like "実装を再開して", "続きをやって", "resume", "continue") AND the input does not contain "PBI", invoke `agent-teams resume` instead of `agent-teams run`. The resume command auto-selects the most recent failed/running task and re-runs only its incomplete sub-tasks. If the user explicitly references a task id (e.g. "01HXABC..."), prefer the dedicated `/team-resume <task_id>` slash command over `/team`.

Execute (for a normal new task or PBI):

```bash
agent-teams run "$ARGUMENTS"
```

Execute (for a resume request, no task id):

```bash
agent-teams resume
```

After the command finishes, read the printed `summary` path and display its contents to the user. Do not perform any coding work yourself beyond invoking the appropriate command.

---

## デザインチェックポイントの扱い

`agent-teams run` または `agent-teams design-resume` の出力に
`STATUS: awaiting_design_approval` 行が含まれる場合、Hana がデザインを
更新してユーザー承認を待っています。次の手順で対話してください:

1. 出力から `TASK_ID: <ulid>`、`ITERATION: <n>`、直後の ```json``` ブロック (design_checkpoint) を抽出
2. ユーザーに以下の形式で提示:

   > Hana がデザインを更新しました（iteration N — `ITERATION:` 行から取得）
   > - 変更ファイル: <modified_files をカンマ区切り>
   > - 要約: <summary>
   > - プレビュー: <preview_images があれば Read ツールで開いて表示>
   >
   > 問題なければ「OK」「進めて」等と返してください。
   > 修正したい点があれば自然に伝えてください。

3. ユーザーの応答を解釈して翻訳:
   - 承認意図（OK / いいよ / 進めて / 良い / fine / approved 等の短い肯定応答）
     → `agent-teams design-resume <task_id> --approve`
   - 具体的な修正依頼（「ボタンを青に」「もう少しゆとり持って」等）
     → `agent-teams design-resume <task_id> --feedback "<ユーザー応答原文をそのまま>"`
   - 判別不能（質問だけ / 雑談）の場合はユーザーに「承認 or 修正依頼」を再確認

4. design-resume の出力にまた `STATUS: awaiting_design_approval` があれば手順 1 に戻る
5. stderr に `warning: design iteration count exceeds 10` を見つけたら、
   ユーザーに「10 回反復しました。続けますか? 一旦承認しますか?」と確認
6. それ以外（task 完了 = 通常の summary が出る）の場合は通常通りユーザーに最終報告を提示

**重要**: ユーザーは追加の slash command を覚える必要はありません。あなた（親 Claude）が
自然言語応答を `--approve` / `--feedback` に翻訳して `agent-teams design-resume` を呼びます。
