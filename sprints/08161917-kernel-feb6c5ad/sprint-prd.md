# Sprint PRD — 起跑 Map 预检：base_sha 落后 main 时按祖先关系重定基，不永久锁死

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（消除第 9 类派发死法，让"建单→派发"窗口跨过 main 前进后任务仍能起跑）

## 背景

2026-08-16 生产实证第 9 类死法：任务建单时 `receipt.evidence.base_sha` 记录当时的 origin/main；
派发前 main 因新 PR 合并而前进，Map 扫描到新 revision 后判 fresh；
`ensureNormalMapImpactPreflight`（`packages/brain/src/orchestrator/preflight/map-impact-contract.js:259`）
硬性要求 `repoFreshness.source_revision === receipt base_sha`，于是先报 `map_revision_mismatch`、
扫描窗口期报 `map_stale`，dispatch 三连败触发 `dispatch_fail_autoblock`（blocked until=manual），任务永久起不来。
Gate3 每次合并自动部署 + 派发 drain 等待，使该窗口高频跨过一次 main 前进，此死法会反复复发。
修法原则：fail-closed 但不永久锁死——落后但同源（祖先关系）自动重定基继续；分叉/回退或扫描器追赶不计入 autoblock。

## Golden Path（核心场景）

系统从 [起跑预检检测到 map revision 与 receipt base_sha 不一致] → 经过 [按祖先关系分流处理] → 到达 [同源自动起跑 / 异源安全回队，均不永久锁死]

具体：
1. 起跑预检发现 `map.source_revision` ≠ `receipt base_sha`（原 `map_revision_mismatch` 触发点）。
2. 若 `map.source_revision` 是 origin/main 上 `receipt base_sha` 的后裔（`git merge-base --is-ancestor base_sha map_revision`）**且** run 尚未开始（无 initiative_runs / 无 attempt）：把 `receipt.evidence.base_sha` 与 `task.payload.base_sha` 重定基到 `map.source_revision`，写一条 `route_rebased` 事件（或新 receipt 版本，保留旧值可审计），预检继续、任务照常起跑。
3. 若不是后裔（分叉 / 回退）：仍 fail-closed，reason_code 明确为 `map_revision_diverged`；**不计入** `dispatch_fail_autoblock`（判定为环境漂移而非派发失败），任务回 `queued` 等下一轮。
4. 若 `map_stale`（扫描器追赶窗口）：**不计入** autoblock 连败，任务回 `queued` 等下一 tick。

## 边界情况

- run 已开始（已有 initiative_runs 或 attempt）但 base_sha 落后 → 不得静默重定基，走原有 fail-closed 路径（避免 run 中途换基）。
- `git merge-base --is-ancestor` 判定所需的 commit 在本地不可达 → 视为无法确认后裔，按非后裔（`map_revision_diverged`）安全处理，不重定基。
- 重定基写事件失败 → 不得吞错继续，需 fail-closed 回队，保证旧 base_sha 可审计。
- 连续多次 `map_revision_diverged` / `map_stale` → 队列不得被 autoblock 锁死（`dispatch_fail_consecutive` 不因这两类递增）。

## 范围限定

**在范围内**：`ensureNormalMapImpactPreflight` 起跑预检的 revision 比对分流逻辑；祖先判定 + 重定基 + `route_rebased` 事件落库；dispatcher 对 `map_revision_diverged` / `map_stale` 不计入 autoblock 连败计数。
**不在范围内**：Map 扫描器 / manifest 生成（禁改）；impact 闸本身的严格度（禁放松，digest/radius/assertion 校验保持不变）；其他类死法（单类死法单 PR）。

## 假设

- [ASSUMPTION: `route_rebased` 事件走现有事件/receipt 版本落库通道；保留旧 base_sha 于事件或旧 receipt 版本以供审计。]
- [ASSUMPTION: "run 尚未开始"以该 task 无 initiative_runs 记录且无 attempt 为判据。]
- [ASSUMPTION: 祖先判定基于本地 origin/main 可达对象，命令为 `git merge-base --is-ancestor <base_sha> <map_revision>`。]

## 预期受影响文件

- `packages/brain/src/orchestrator/preflight/map-impact-contract.js`：`ensureNormalMapImpactPreflight` 内 revision 比对（:256-259）改为祖先分流 + 重定基 + 事件落库。
- `packages/brain/src/dispatcher.js`：捕获 `map_revision_diverged` / `map_stale` 时不递增 `dispatch_fail_consecutive` / 不触发 `dispatch_fail_autoblock`。
- `packages/brain/src/orchestrator/preflight/map-impact-contract.test.js`：新增回归用例（先红）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: `route_rebased` 重定基事件必须落库、保留旧 base_sha 可审计；`map_revision_diverged` / `map_stale` 需以明确 reason_code 记录

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [fail-closed] 起跑预检默认 fail-closed；仅"同源后裔且 run 未开始"才允许自动重定基放行（来源: 本 sprint 约束）
- [禁改扫描器] 禁改 Map 扫描器 / manifest；禁放松 impact 闸（digest/radius/assertion 校验不变）（来源: 本 sprint 约束）
- [nightly-red 归因] 连续 ≥3 晚同一 job 红时，issue 需贴失败 step 最后 20 行原始 stdout 而非 PowerShell 截断输出（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史：F1 line 现有 ability 均为 planned，无 done/working 状态）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入真实脚本（local_api → vitest + curl localhost:5221 + psql）
# 期望验收点（自然语言）：
# 1) vitest：base_sha 落后 map 且为祖先 + run 未开始 → 重定基成功，新 receipt/payload base_sha = map revision，route_rebased 事件落库。
# 2) vitest：map 与 base_sha 分叉（非祖先）→ 抛 map_revision_diverged，dispatch_fail_consecutive 不递增，任务回 queued。
# 3) vitest：map_stale → 不计入 autoblock 连败，任务回 queued。
# 4) 真 run：本任务自身在 main 前进后仍能起跑，route_rebased 事件写进本 sprint 证据目录。
```

## journey_type: autonomous
## journey_type_reason: 改动仅落在 packages/brain/ 起跑预检与 dispatcher 后端调度逻辑，无 UI / agent 协议 / engine 介入。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；验收走本地 vitest + curl localhost:5221 + psql，无需远端机器。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
