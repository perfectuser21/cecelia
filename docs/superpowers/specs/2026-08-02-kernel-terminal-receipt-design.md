# Kernel Harness 终态收据与跨 Run 分支唯一性设计

## 目标

修复真实 Run `006eb10d-91fd-4093-9902-6a89518b89fe` 暴露的两个连续阻塞：Codex 已发出合法 `turn.completed` 和结构化最终结果却因较早的内部错误保留 exit 1；Planner 新 Run 仍复用旧的 task+hop 分支名。

## 裁决

Runner 不再把 Codex 进程退出码当作唯一业务终态。仅当以下条件全部成立时，允许把非零退出恢复为 Provider 完成：

1. JSONL 中最后一个终态事件是 `turn.completed`，且不存在 `turn.failed`；
2. 最后一条 `item.completed/agent_message` 可解析为 JSON，并与 `--output-last-message` 文件语义相等；
3. 结果对象满足现有 HarnessResult 基础合同；
4. 既有 evidence capsule、凭据红线、冻结基线断言仍全部通过。

恢复时保留原始 CLI 退出码到 `provider_metadata.cli_exit_code`，并标记 `terminal_receipt=turn.completed`。没有完整收据的 exit 1 继续 fail closed。

Planner 分支改为 `cp-harness-prd-<task8>-r<run8>-a<hop>`，Proposer 分支改为
`cp-harness-propose-r<round>-<task8>-r<run8>-a<hop>`。run ID 是服务端 TaskBundle
字段，因此同一 task 的不同 Run 不再争用远端 ref；Runner finalizer 同时校验
task、run、hop/round 边界。Ground Truth 只发现当前 run 的新格式 proposal；旧格式
仅在当前 run 已有精确 Attempt TaskBundle 引用时兼容，禁止误吃其他 Run 的历史 ref。

## 不做

- 不吞掉 `turn.failed`、超时、输出缺失、Schema 不符、血统违规或证据篡改。
- 不修改 Skill 内容或模型路由。
- 不在本 PR 建全局 Codex 账号租约；真实回跑避免与当前前台共用 team1。

## 验收

- Red 复现 exit 1 + 完整完成收据当前被判失败，Green 后被严格恢复。
- exit 1 + 缺 agent message、结果不一致、`turn.failed` 均保持失败。
- 两个 Run 同 task/hop 生成不同 Planner/Proposer 分支，proposal discovery 不跨 Run。
- Runner 合同、Brain 单测、DevGate、镜像 smoke 全绿；新 digest 部署 US M4 后完成真实全链。
