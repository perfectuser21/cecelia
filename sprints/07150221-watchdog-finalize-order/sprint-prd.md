# Sprint PRD — 刀A2：收口顺序 + _parseBaseRepo 容器内解析修复

task_id: 5e9c0496-a7a9-4889-b536-8094c25da604
sprint: 07150221-watchdog-finalize-order
date: 2026-07-15

## 背景

`#3886` 已 MERGED，但 `initiative_runs.pr_url` 为空（relay session 未回写），导致：
1. watchdog 每轮判断 `generator_done=true` → 跳过重点火，finalize 永远轮不到。
2. `_discoverPrFromGithub` 调用 `_parseBaseRepo`，容器内拿到宿主机路径
   `/Users/administrator/perfect21/cecelia`（不是 `owner/repo` 格式），返回 `null` → 反查失明。
3. 人工 `UPDATE initiative_runs.pr_url` 后，watchdog 立即正确收口（有凭证 completed）。

根因：`_parseBaseRepo` 只识别 `https://github.com/<owner>/<repo>` 格式，
不识别宿主机绝对路径；且 `generator_done=true + pr_url 空` 分支未进入 `_discoverPrFromGithub`。

---

## Invariant 约束

1. **不改 generator_done 超时兜底语义**：`GENERATOR_DONE_TIMEOUT_MS = 6h`，到期仍无 MERGED → 标
   `failed`（`failure_reason='generator_done_timeout'`）。此行为不变。
2. **只动 watchdog + _parseBaseRepo**：不碰 spawn、`_finalizeMergedRun` 内部逻辑、
   evaluator gate 判断、`_raiseUngatedMergeAlert`。
3. **保守失明**：`_discoverPrFromGithub` gh 调用失败 → `continue`（不盲目重点火），此行为不变。
4. **防双 PR**：`generator_done=true` 时绝不二次 spawn；fallback 反查后若发现 MERGED 走
   `_finalizeMergedRun`，发现 OPEN 写回 `pr_url` 并 skip 重点火——两路均不重新 spawn。
5. **分支规约**：按 `cp-*-<short>*` / `cp-*-ws-<short>*` headRefName 或 `[<short>]` title 匹配。

---

## 累积 FR

### FR-1：generator_done=true + pr_url 空 → 触发反查并收口
**现状**：`generator_done=true` 分支直接 `continue`（第 418–421 行），未进入 `_discoverPrFromGithub`。
**目标**：在进入 `generator_done=true → 跳过重点火` 的 `continue` 前，先调
`_discoverPrFromGithub`；若发现 MERGED → `_finalizeMergedRun(setPrUrl=true)`；
若发现 OPEN → 回写 `pr_url`；无命中 → 继续 `continue`（跳过重点火）。
日志必须包含 `discovered_merged_via_fallback` 关键词（当发现 MERGED 时）。

### FR-2：_parseBaseRepo 支持宿主机绝对路径映射
**现状**：`_parseBaseRepo` 只匹配 `https://github.com/` URL，绝对路径返回 `null`。
**目标**：新增路径→仓库名映射表，默认含：
- `/Users/administrator/perfect21/cecelia` → `perfectuser21/cecelia`（或读 GITHUB_REPOSITORY）
- `/workspace` → `perfectuser21/cecelia`（容器内常见 cwd）
- ZenithJoy 对应路径（待确认，可留 env HARNESS_REPO_MAP 覆盖）

优先级：URL 格式优先；路径匹配其次；`HARNESS_REPO_MAP`（JSON 字符串）可完全覆盖默认表。

### FR-3：反查发现 OPEN 时回写 pr_url（已有行为，防回归）
`_discoverPrFromGithub` 发现 OPEN → `UPDATE initiative_runs SET pr_url` + skip 重点火。
现有逻辑在 `effectivePrUrl` 为空分支（第 365–391 行）已实现；FR-1 路径不得改变此行为。

### FR-4：failing test 先 commit（测试先行）
三条 failing 测试须在修复代码之前以独立 commit 入库，永久留在 CI 回归套件。

---

## NFR

- 修改文件：`packages/brain/src/harness-relay-watchdog.js`（仅 `_parseBaseRepo` + `resumeStalledRelayRuns` 中
  `generator_done` 分支）；对应 test 文件 `__tests__/harness-relay-watchdog.test.js`。
- 既有 watchdog 测试全部通过（无回归）。
- 新日志关键词 `discovered_merged_via_fallback` 便于 grep 监控。
- `HARNESS_REPO_MAP` 为可选 env，JSON 格式，缺失时使用硬编码默认表。

---

## Golden Path（验收断言）

| # | 场景 | 断言 |
|---|------|------|
| GP-1 | `generator_done=true + pr_url 空 + mock 反查命中 MERGED` | 当轮 `_finalizeMergedRun` 被调，`pr_url` 写回，日志含 `discovered_merged_via_fallback` |
| GP-2 | `_parseBaseRepo('/Users/administrator/perfect21/cecelia')` | 返回 `perfectuser21/cecelia`（路径不存在场景） |
| GP-3 | 反查命中 OPEN | 写回 `pr_url` + 跳过重点火（不二次 spawn） |
| GP-4 | 既有 watchdog 全部测试 | 全部通过（无回归） |

---

journey_type: bug_fix
target_environment: brain_unit_test
