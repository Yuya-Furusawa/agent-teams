---
description: アイデアから Product Backlog Item を生成して Obsidian Vault に書き出す
argument-hint: <PBI のアイデア（自然言語）>
allowed-tools: Bash(agent-teams:*), Read
---

agent-teams の PBI 作成モードを起動します。Pax (PdM) → Quinn (QA) ∥ Aki (Eng) が
協力して PBI を起こし、設定済みの Obsidian Vault に書き出します。

実行:

```bash
agent-teams pbi "$ARGUMENTS"
```

実行後、stdout を見て分岐してください:

1. **`task: ... / pbi: PBI-NNN / path: /...`** が出力された場合
   - 完了です。番号とパスをそのままユーザーに表示してください。
   - 「実装フェーズに進める場合は `/team NNN` を実行してください」と添えてください。

2. **`<<<PBI_QUESTIONS task_id=... pbi_id=...>>> ... <<<END>>>`** ブロックが出力された場合
   - PBI の背景セクションを書くために情報が不足しています。Pax から質問が出ています。
   - sentinel ブロック内の JSON `{questions: [...]}` を parse してください。
   - 各 `question` をユーザーに丁寧に提示し、回答を集めてください（1-2 行ずつでよいことを伝える）。
   - 全質問に回答が揃ったら、回答を `{q1: "...", q2: "..."}` 形式の JSON にまとめ、以下を実行してください:

   ```bash
   agent-teams pbi-resume <task_id> --answers '<JSON 文字列>'
   ```

   - 結果は (1) と同じ `task: / pbi: / path:` 形式で返ります。

ユーザーの回答収集中にスラッシュコマンドを中断した場合、
後日 `agent-teams pbi-resume <task_id>` で再開できることをユーザーに伝えてください。
