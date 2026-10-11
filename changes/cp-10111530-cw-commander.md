## Brain {VERSION} — coding commander：runner 升级后自动起 Opus 会话裁决并解除（决策 c167d6e3）

- 新环节 runner/lib/commander.mjs（合并门之后、CI 修复之前）：QA 门 / CI 修复升级（judge_contract_gap、judge_ruling_conflict、qa_fix_failed、qa_stalled、qa_cannot_verify、ci_fix_exhausted）后起 Opus 会话按规格逐条裁决；可在 02-spec.md 末尾追加「commander 裁决」节、TDD 修代码、给 CI 修复重置额度；程序核对（不许改需求 01/受保护路径/削弱测试，规格只许纯追加）后推送，写 07-commander-rN.md，解除升级，记 Brain result.commander_overrides 与 commander span
- 上交主理人（Bark，同一升级只通知一次）：裁决 action=human、会话失败/输出不合格/核对不过、本 PR 介入满 3 次、基础设施类升级；记 result.commander_human
- 迁移 547：coding workflow 第 13 个 Activity「coding commander」
- qa_stalled 解除后按 stall_floor 重新计不收敛；状态镜像加 stall_floor/smoke/smoke_note/archived_attempts/commander_state
- 独立裁判提示词：smoke 生产保护未授权 exit 0 是仓库约定，不算产品问题（决策 45cd3ec2）
- 开关：CODING_WF_COMMANDER（默认开）、CODING_WF_COMMANDER_MAX（默认 3）、CODING_WF_COMMANDER_TIMEOUT_MS（默认 40 分钟）；Bark 读 BARK_TOKEN 或 ~/.credentials/bark.env
