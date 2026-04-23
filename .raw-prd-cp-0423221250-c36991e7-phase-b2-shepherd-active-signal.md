# Phase B2 — shepherd 误判修复

## Goal
Shepherd 现状："retry_count >= 3 就 quarantine"会误杀活跃推进中的 task。加"活跃信号"判断：只有当 retry_count 高 **且** 最近无活跃信号（checkpoint 最近 90s 无 write + 对应 docker container 不 running）时才 quarantine。

## 背景
Phase A 开工时现场发生：Task 76530023 被 shepherd 错误 quarantine（docker spawn 22.7s failed 后，interactive claude 仍在独立 worktree 推进，shepherd 看 retry_count=2/3 + failure_count=2 直接打入 24h quarantine）。Brain v2 spec §7.2 明文要求活跃信号判定。

## Tasks
1. 定位 shepherd 逻辑（packages/brain/src/ 下 shepherd.js 或 tick.js 里的 shepherd 分支）
2. 加"活跃信号"辅助函数 `hasActiveSignal(taskId, attemptN)`：
   - SQL：`SELECT 1 FROM checkpoint_writes WHERE thread_id LIKE '{taskId}:%' AND created_at > NOW() - INTERVAL '90 seconds' LIMIT 1`（若 LangGraph checkpointer 表已存在）
   - Fallback：检查 `.dev-lock.*` 文件 mtime < 90s 或 container ps 含 task_id
3. 修改 quarantine 条件：`retry_count >= 3 AND NOT hasActiveSignal()`
4. 单测覆盖 "retry_count=3 + checkpoint 最近写 → 不 quarantine" 场景
5. 现有 shepherd 测试不退化

## 成功标准
- shepherd quarantine 不误伤 "retry 高但 checkpoint 最近写" 的活跃 task
- 单测至少 1 个 "活跃信号 bypass" case pass
- 现有 shepherd / tick 测试全 pass
- Phase A 遭遇的 Task 76530023 Unquarantine 逻辑仍合理（quarantine 后 24h 超时释放不变）

## 不做
- B1（thalamus LLM API 充值）— 需 Alex 决策，不在本 PR 范围
- B3（Brain restart 循环诊断）— 独立 PR
- Phase E Observer 分离（shepherd 搬家到 observers/）— 大改，独立 Phase
- checkpoint_writes 表 schema 不动（用现有表）
- 不改 quarantine TTL（仍 24h）

## DoD
- [BEHAVIOR] hasActiveSignal 函数存在且被 shepherd quarantine 前调用；Test: manual:node -e "const fs=require('fs');const f=require('glob').sync('packages/brain/src/**/shepherd*.js').concat(require('glob').sync('packages/brain/src/tick.js'));let found=false;for(const p of f){if(fs.readFileSync(p,'utf8').includes('hasActiveSignal')){found=true;break}}if(!found)process.exit(1)"
- [BEHAVIOR] 新增单测含"retry_count 高但活跃"场景且 pass；Test: tests/packages/brain/
- [BEHAVIOR] 现有 shepherd 测试不退化；Test: manual:npm test --workspace=packages/brain --prefix . -- shepherd

## 风险
- 活跃信号数据源（checkpoint_writes vs cidfile vs dev-lock）选择：checkpoint_writes 最权威但需 LangGraph checkpointer 已有表；dev-lock 最简单但 harness docker 跑的不写 dev-lock
- 太宽松活跃判定 → 真死 task 不 quarantine 浪费 slot；太严 → 本 Bug 复发
- shepherd 改动若影响其它 task_type，需全面测

## 参考
- Roadmap: docs/design/brain-v2-roadmap-next.md §Phase B2
- Spec: docs/design/brain-orchestrator-v2.md §7.2
- 现场案例: Task 76530023 2026-04-23 12:17 UTC quarantine log

