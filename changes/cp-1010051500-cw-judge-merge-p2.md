## Brain {VERSION} — coding harness：裁判看完整改动、追究范围蔓延与安全问题、疑虑可见、合并删分支

- 决策 a1fdbc51 审计 P2：
  - #43 裁判必须看到完整改动：上限 6 万 → 15 万字（JUDGE_DIFF_LIMIT）；PR 改动超限不再截断照判，直接升级 judge_input_truncated（不算裁判坏、不重试）。
  - #39 #40 裁判提示词：与任何 I-n 都无关的改动（范围蔓延）、安全与数据破坏（注入、凭据入代码/日志、越权、删改已有数据、不可逆迁移）记「重要」。
  - #41 「完成但有疑虑」可见：裁判建议级问题写进 Brain result.qa.concerns。
  - #28 合并门合并时带 --delete-branch。
