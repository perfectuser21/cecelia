# PRD: Tier 2 PR-B — dispatcher 真路径 smoke

## 背景

承接 Tier 0/1/PR-A（PR #2664/#2665/#2666 已合）。4 agent 审计找出 dispatcher.js 是 brain 调度引擎核心，但单测全部 vi.mock 掉 db / executor / langgraph，**0 真路径覆盖**。

PR #2660 的 Phase 2.5 retired drain bug 就是典型：单测全过 → CI 绿 → merge → deploy → **当场 drain 24 个本来卡死的任务**。如果当时有真 smoke 跑过，bug 当天就会被 CI 抓住。

## 用户原话

> 我现在只需要你解决的是整个 foundation 的问题... 是否能够真正的加这个 1 to 1 的 test，这是关键

dispatcher 必须有真 1-to-1 的 real-env smoke。PR-A 的 lint-test-quality 拦了"假测试 stub"，PR-B 给最关键的核心模块补上"真测试 smoke"。

## 范围

### 一、新增 `packages/brain/scripts/smoke/dispatcher-real-paths.sh`（130 行，3 case）

- **Case A**：pre-flight 短 title reject —— title="ab"+2 hex 触发 `Task title too short (<5)` → metadata.pre_flight_failed=true
- **Case B**：empty queue dispatch —— 无可派 task 时 POST /tick 返回 HTTP 200 不抛
- **Case C**：initiative-lock —— 同 project_id 注 2 个 harness_initiative，只 1 个能进 in_progress

### 二、唯一性 + timeout 防卡设计

- SMOKE_RUN_ID = `$(date +%s)-$$` 防跨 run dedup constraint 冲突
- Case A title 用 4 字符 short hex 后缀（保持 <5 触发 pre-flight + dedup unique）
- Case C project_id 用随机 12 hex（UUID 格式合法）
- 所有 curl `-m 10` timeout 防 /tick 偶发慢卡死整个 smoke

### 三、CI 自动接入

real-env-smoke job 已自动跑 `packages/brain/scripts/smoke/*.sh`，新 smoke 自动纳入，不需改 ci.yml。

### 四、executor.js 真 smoke 不在本 PR 范围

- executor 的 retired-type defense-in-depth 已被 `retire-harness-planner-smoke.sh` 间接覆盖
- preparePrompt / spawn 的真路径需要真 cecelia-bridge 才能跑全程，CI clean docker 不具备
- 后续如要加 executor smoke 走 PR-C 单独处理

### 五、Engine 18.10.0 → 18.11.0

## 验收

- 本 PR push 后 real-env-smoke job 自动跑 dispatcher-real-paths.sh 全 ✅
- 后续 dispatcher.js 任何改动如果破坏 pre-flight / empty-queue / initiative-lock 任一行为，CI 当场拒
