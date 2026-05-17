# Learning: intent-expand + Learning 检索集成到 fetch-task-prd.sh

**分支**: cp-03220357-3c6070e3-8a41-4eaa-96e5-b8f12a
**日期**: 2026-03-22
**领域**: agent_ops / engine

## 功能背景

在 `fetch-task-prd.sh` 中新增两个功能：
1. `fetch_intent_context`：沿 goal_id → KR → OKR → Vision 链查询战略上下文，注入 PRD
2. `search_related_learnings`：从任务标题提取关键词，搜索 `docs/learnings/` 推荐相关历史经验

## 根本原因

01-spec.md 文档（1.1.5 和 1.3.5 章节）已描述这两个功能的期望行为，但 `fetch-task-prd.sh` 脚本从未实际实现。Agent 使用 `--task-id` 时生成的 PRD 缺少：
- 任务的战略上下文（"这个任务是为了什么 KR/OKR"）
- 历史踩坑记录（相关 Learning 推荐）

导致 Agent 实现方向可能与战略目标偏离，且重复踩历史坑。

## 关键实现决策

### 1. grep -F 而非 grep（防注入）

Learning 搜索用 `grep -Frl` 而非 `grep -rl`，因为任务标题可能含 `[`、`*` 等正则元字符。使用 `-F` 强制字面量匹配，避免意外的正则解释。

### 2. 链路遍历用 `|| true` 保护

每个 curl 调用加 `|| true`，确保 Brain API 失败（如 goal_id 无效）时不中断脚本执行。`set -euo pipefail` 下尤其重要。

### 3. 函数返回值用 `return 0`（不是 `exit`）

bash 函数中遇到无上下文时用 `return 0` 而非 `exit 0`，避免整个脚本提前退出。

### 4. 无上下文时 PRD 不输出空段落

`generate_prd` 只在 `intent_context` 非空时才写入"战略上下文"章节，保持 PRD 干净。

## 下次预防

- [ ] Brain API 可能返回空数组 `[]` 而非 `null`，jq 的 `// empty` 对数组无效（数组视为 truthy）。未来如需处理数组类型字段，用 `if . == null or . == [] then empty else . end`
- [ ] `search_related_learnings` 当前按空格切词，纯中文无空格标题可能只提取出 1 个关键词，效果有限。未来可考虑接入分词 API 或按字数切割
- [ ] intent-expand 目前是单向读取（不写入 Brain），未来若需要将丰富后的 PRD 回写至 `metadata.enriched_prd`，需走 PATCH 端点
