## Brain {VERSION} — coding workflow 所有 claude 会话钉死 Opus 5.5

- 决策 ac7c8801：coding 研发在 MMV 用 Claude Code，Commander 与链上 claude 会话固定 Opus 5.5。实测 runner 起的 6 次会话 init 模型均为 claude-sonnet-5-5。
- lib/claude.mjs runClaude：调用方没给 --model 时末尾追加 `--model claude-opus-5-5`（CODING_WF_CLAUDE_MODEL 覆盖），spec/build/verify/ci_fix 统一生效；真实 claude CLI 实测会话模型为 claude-opus-5-5。
