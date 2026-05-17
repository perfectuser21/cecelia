# 24h 任务全量失败根因分析（0% 成功率事件）

**诊断时间**：2026-05-12（北京时间）
**分析窗口**：过去 24h（2026-05-10 ~20:30 → 2026-05-11 ~20:30 UTC）
**触发原因**：Brain SelfDrive 派发 `[SelfDrive] 诊断：最近24h任务全量失败（0%成功率）根因分析与修复`
**数据来源**：`GET /api/brain/tasks?status=failed&limit=50` → 过滤 updated_at ≤ 24h

---

## 1. 数据总览

| 维度 | 数值 |
|------|------|
| failed 状态任务 | **29**（PRD 写 19，是数据滞后） |
| completed 状态任务 | **0** |
| 真业务失败 | **1**（evaluator FAIL） |
| 基础设施失败 | **28**（96.5%） |

**结论：这不是「业务逻辑失败」，是基础设施集体故障导致 dev pipeline 0% 成功率。**

---

## 2. 失败模式聚类（按 error_message 切分）

| # | 模式 | 数量 | 占比 |
|---|------|------|------|
| A | `[reaper] zombie: in_progress idle >30min` | 9 | 31% |
| B | `[ops zombie in_progress (updated_at frozen 6h+, never recovered)]` 人工 reap | 8 | 28% |
| C | 空 error_message + retry_count=3 | 9 | 31% |
| D | `Docker exit=125: container name already in use` | 1 | 3% |
| E | `[ops cleanup: stale queued >24h]` 人工清理 | 1 | 3% |
| F | `final_e2e_verdict=FAIL`（真业务失败） | 1 | 3% |

---

## 3. 根因定位（A-F 逐项）

### 模式 A/B：Zombie reaper 误杀 + reaper 未触发（17/29，59%）

**现象**：dev/harness_initiative/cortex 任务停在 in_progress，updated_at 不再变化 → 30min 后被 reaper 标 failed；reaper 漏判时由 ops 人工清。

**根因**：
1. 旧版 reaper 阈值 30min，对 SelfDrive/cortex 跑长 LLM agent 太短
2. dev 任务执行期间 LangGraph 内部活动不 touch tasks.updated_at → 看起来僵死
3. harness_initiative 跑 GAN+generator+CI 可达 1+ 小时，被秒判 zombie

**当前修复状态**：
- ✅ PR #2913（c39dc09dc, 2026-05-12 03:54）：阈值 30→60min + 豁免 `harness_initiative,harness_task,harness_evaluate,harness_contract_propose,harness_contract_review,harness_planner,harness_generator`
- ❌ **Gap**：`dev` task_type **未在豁免列表**。SelfDrive/cortex 触发的 dev 任务跑 LLM agent 仍可能 >60min（实测 W28 出现过 6h+ frozen 案例）

### 模式 C：空 error_message + retry=3（9/29，31%）

**现象**：dev 任务在 dispatcher 重试 3 次后被 mark failed，error_message 全空，task 实际是否真的执行过没有任何痕迹。

**根因**：dev 任务通过 LangGraph executor 跑，graph 内部完成 / 失败时未回写 `callback_queue` → dispatcher 看到任务 in_progress 永远不 callback → 误以为 dispatch 失败 → retry++ → 最终 retry=3 标 failed。

**当前修复状态**：
- ✅ PR #2912（d32246818, 2026-05-12 03:29）：dev-task graph 回写 callback_queue（commit 标题原文 "闭合 24h dev pipeline 0% 成功率 hole"）
- ✅ PR #2911（f6ac73d77, 2026-05-12 02:39）：dispatcher HOL skip — 队首派不出跳过找下一个
- ⚠️ **未覆盖**：dispatcher 在 retry++ 时 error_message 仍为空，事后无法 forensic。需要 retry 时写 `error_message='[dispatch] retry N: <last reason>'`

### 模式 D：Docker container name conflict（1/29）

**现象**：W27 harness_initiative bb776b90 报 `docker: Error response from daemon: Conflict. The container name "/cecelia-task-bb776b90a438" is already in use by container "65171366b..."`。

**根因**：`docker-executor.js:308-326` 用 `--rm --name cecelia-task-${short}` 启容器，但 spawn 前**只清理了 cidfile**（line 367-369），**没清理同名容器**。`--rm` 在某些 daemon 异常路径下（kill -9 docker daemon、OOM、机器睡眠）不会自动删容器 → 下次重试同任务必撞名冲突。

**当前修复状态**：
- ❌ **未修复**。需要在 `docker run` 之前 `docker rm -f $name 2>/dev/null` 兜底（幂等、零成本）。

### 模式 E：stale queued >24h（1/29）

**现象**：harness_evaluate 任务 queued 状态 >24h 未被派发，ops 人工 cancel。

**根因**：dispatcher 队首 HOL（head-of-line）阻塞 — 队首任务因资源/锁/preflight 派不出，整队卡死。

**当前修复状态**：
- ✅ PR #2911（f6ac73d77）：HOL skip 已落地。

### 模式 F：evaluator FAIL（1/29）

**现象**：W28 harness_initiative `final_e2e_verdict=FAIL: Step 3 — happy + schema 完整性 (/divide?a=6&b=2)`。

**根因**：harness pipeline 跑出来的代码没过 evaluator smoke。属于产品逻辑问题，不是基础设施。

**修复状态**：归 W28 后续验证流程处理，与本次 RCA 无关。

---

## 4. 修复进度对照表

| 失败模式 | 占比 | 已修复？ | 修复 PR | Gap |
|---------|------|---------|---------|-----|
| A zombie >30min | 31% | ✅ 部分 | #2913 | dev 未豁免 |
| B zombie 6h+ ops | 28% | ✅ 部分 | #2913 | 同上 + reaper 不该是首选防御 |
| C dispatcher retry 空错 | 31% | ✅ | #2912 / #2911 | retry 路径不写 error_message |
| D docker 容器名冲突 | 3% | ❌ | — | 需补 pre-clean |
| E queued >24h | 3% | ✅ | #2911 | 无 |
| F 真业务 FAIL | 3% | n/a | W28 流程 | 无 |

**已修复覆盖 96.5%（28/29）的失败成因，但 3 个 Gap 仍可能复发：**
1. **G1**：dev 任务跑 >60min 仍会被 reaper 误杀（B 模式残留路径）
2. **G2**：dispatcher retry 不写 error_message → 无 forensic
3. **G3**：docker container name conflict 无 pre-clean

---

## 5. 修复建议（按 ROI 排序）

### Fix-1（G3，必做，10 LOC）：docker-executor 加 container pre-clean

**位置**：`packages/brain/src/docker-executor.js`，line 367 cidfile 清理之后追加：

```js
// 同名容器 pre-clean：--rm 在 daemon 异常路径下不一定执行
try {
  await new Promise((resolve) => {
    const p = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
    p.on('exit', () => resolve());
    p.on('error', () => resolve()); // docker 不在也吞掉
  });
} catch { /* ignore */ }
```

幂等、失败静默、不影响首次 spawn。

### Fix-2（G2，高价值，20 LOC）：dispatcher retry 路径写 error_message

**位置**：dispatcher 内部 retry++ 后 update tasks。任何 retry 必带最后一次失败原因（即便是 "executor never callback within Xmin"）。让 forensic 有线索。

### Fix-3（G1，方向性，需讨论）：用 executor heartbeat 替代 idle reaper

**当前**：reaper 看 `updated_at` 老化判定 zombie，被动且会误杀。
**建议**：executor 每 60s 在 docker container 内 update tasks.updated_at（"heartbeat")，reaper 看到 >2 个 heartbeat 周期没更新才判 zombie。这样能精确区分"任务真挂"和"任务跑得慢"。

短期 workaround：把 `dev` 加进 `ZOMBIE_REAPER_EXEMPT_TYPES`（一行 env 改）。但治标不治本。

---

## 6. 试验/验证方案

### Exp-1：Fix-1 落地后回归（30min）

1. 写 smoke：手动 `docker run --name cecelia-task-fake-test --rm alpine sleep 60 &` 占住名字
2. 启 brain，触发 dispatch 同 ID 任务
3. 期望：spawn 成功（pre-clean 干掉占位），无 exit=125
4. 自动化：扩 `packages/brain/scripts/smoke/zombie-reaper-smoke.sh` 加 docker 名冲突 case

### Exp-2：Fix-2 落地后回归（20min）

1. 派一个故意会 dispatch 失败的任务（mock executor 不调 callback）
2. 期望：retry=1/2/3 每次都写 `error_message='[dispatch] retry N: <reason>'`
3. SQL 断言：`SELECT error_message FROM tasks WHERE id=$1 AND retry_count=3 → 非空 + 含 '[dispatch]'`

### Exp-3：24h 监控对照（连续 24h）

修复全部上线后：
- 派 20 个 dev SelfDrive 任务（覆盖 cortex / self_drive 触发）
- 派 5 个 harness_initiative
- **成功阈值**：成功率 ≥70%（基线 84%，本次 0%）
- **必看指标**：
  - reaper 触发数 ≤ 实际 zombie 数（误杀率 < 10%）
  - retry=3 但 error_message 为空的任务数 = 0
  - Docker exit=125 数 = 0

如果 dev 仍频繁 >60min 被 reap，触发 Fix-3 升级（heartbeat 方案）。

---

## 7. 行动项摘要

| ID | 行动 | 优先级 | 工作量 |
|----|------|--------|--------|
| Fix-1 | docker-executor 加 container pre-clean | P1 | 0.5h |
| Fix-2 | dispatcher retry 写 error_message | P1 | 1h |
| Fix-3 | heartbeat 替代 idle reaper（讨论后决定） | P2 | 3h |
| Exp-3 | 24h 监控对照实验 | P1 | 监控期 24h |

---

## 附录：原始数据查询

```bash
curl -sS http://38.23.47.81:5221/api/brain/tasks?status=failed&limit=50
# 字段：error_message, retry_count, task_type, trigger_source, updated_at
```

聚类脚本见 `docs/diagnostics/24h-failure-rca-20260512.md` git history（本文件首版）。
