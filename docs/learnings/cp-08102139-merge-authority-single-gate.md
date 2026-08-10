---
id: cp-08102139-merge-authority-single-gate
task_id: 9806d99a-6973-4252-b298-0135086b84bf
created: 2026-08-10
category: harness-kernel
---

# Learning — 合并权收归单一裁决闸：用 required check 让三通道物理收敛

## 背景

系统里有三条互不知晓的 PR 合并通道，其中两条完全绕过 harness evaluator+judge 裁决。
2026-08-10 两次实证：

- **通道 1（CI 通用 auto-merge）**：`should-auto-merge.sh` 按 PR 标题 `feat(harness):` 判归属。
  #4755 标题 `fix(orchestrator): ...`（非该前缀）→ 判 MERGE，`evaluate_verdict`/`judge_verdict`
  均 NULL 即被合并。**根因：标题是 LLM 自由撰写字段**，generator 按改动类型选前缀，非
  `feat(harness):` 的 harness 产出全部漏过。
- **通道 3（engine-pr-watchdog，此前未被识别）**：对任何 CI 转绿的 PR 起 GitHub 原生
  `--auto`，不读标题、不查裁决。#4759（judge 明确 FAIL）仍被强合。

## 关键结论：改判据不够，必须让「物理上不可合并」

「把标题判据换成更可靠的归属判据」只覆盖通道 1；通道 3 根本不看任何归属标记，任何「改判据」
的方案对它无效。正解是**引入 GitHub 原生 required check `harness-judge`**：

- harness-owned PR 上该 check 默认非 success；`--auto` 与通用 auto-merge 都会等待 required
  checks → 三条通道**自然收敛到同一个闸**，无需逐个改调用方。
- 只有 kernel 走完 `mergeGate`（evaluate PASS + judge PASS + verdict SHA==head + 人审）到达
  `merge_pr` 时，才在真正 `gh pr merge` **之前**用版本无关 REST 置 `harness-judge=success`。

## 两个易踩的坑

1. **归属判定只能凭 kernel 写入的记录，不能凭标题/分支正则**。新增 Brain 端点
   `GET /harness/pr-ownership` 查 `initiative_runs`（`orchestrator_version='v2'` +
   `pr_url`/关联 task 的 `payload->>'pr_branch'`）。Brain 异常一律 **fail-closed=SKIP**
   （宁可暂缓 /dev，绝不放行未裁决的 harness PR）；`curl` 必带 `--max-time` 防 Brain 挂起时
   auto-merge job 无限死等 CI。

2. **required check 一旦登记为分支保护会作用于所有 PR**——手动 /dev 的 not-owned cp-* PR
   拿不到 `harness-judge=success` 会被**永久卡死**（误拦 = 卡死所有 /dev，红线）。兜底：
   ci.yml auto-merge job 在 `DECISION==MERGE`（not-owned）分支下主动对该 PR head SHA 置
   `harness-judge=success`，再交 `--auto` 排队。

## 测试侧坑：同进程 http stub + execFileSync 会死锁

合同测试用「真 node:http stub server + 真 curl」驱动脚本（禁 mock HTTP 边）。若用
**同步** `execFileSync` 跑脚本，node 事件循环被阻塞，同进程 stub 永远无法应答 curl →
curl 必超时 → 所有用例都巧合走进 fail-closed SKIP，`owned=false→MERGE` 用例因此永远失败。
必须用**异步** `execFile`（await）让事件循环空闲应答。

## 合同瑕疵修正（非削弱）

合同 seed `initiative_runs.phase='D_merge'` 不在 `initiative_runs_phase_check` 枚举内
（migrations 238/312/367/382 全无该值），逐字执行会 CHECK 违反、seed 失败、B-01/E2E 永不可跑。
归属查询只按 `orchestrator_version='v2'` 过滤、与 phase 无关，故改为合法枚举 `'evaluate'`，
断言强度不变。
