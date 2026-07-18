# Sprint PRD: 认领制三闸——island-check 出生有主 + 踩无主提示 + 无主棘轮进 nightly

> task_id: 0bbbadcd-6ebe-4d46-8210-28d8119bceb6
> sprint_dir: sprints/07181823-claim-gates
> 生成时间: 2026-07-18
> 参考: docs/handoffs/202607181805-972402fb.md（刀A2 五查询端点）

---

## 背景与目标

刀A1/A2 已落地 `graph_edges` 表 + 五查询端点（locate/related/radius/island-check/claim-status）。
存量文件无主覆盖率极低（verified: 1/174 covered），需在**不堵存量**的前提下：
1. **新增文件**从第一天起必须接入关系图，否则 CI 红；
2. **nightly** 产出无主比例数字，形成只降不升的棘轮，量化债务；
3. **radius/island-check 日志**对触碰的无主存量文件打三选一提示（收编/判死/挂起），引导人工后续处置。

---

## Invariant 约束

| # | 约束 | 来源 |
|---|------|------|
| I1 | CI 闸**只**检查本 PR 新增（`git diff --name-only --diff-filter=A`）的 `packages/brain/src/**` 文件；存量文件**一律豁免**，不重新扫 | 任务描述"存量豁免" |
| I2 | 孤岛判定等价逻辑：在 CI 内建临时 cecelia_test DB → migrate → scan-graph（仅本分支新增文件的 import/spawn/http 边）→ 若结果为 `isolated`（不在任何 covered 认领域）即红 | 任务描述"CI 无生产图" |
| I3 | 无主棘轮：当日无主比例 > 历史最高值（rolling max）→ 开 `[claim-ratchet-red]` Issue；只降不升 | thin_prd "只降不升，升即报警" |
| I4 | 踩无主提示**只写进日志/响应**，不做交互、不自动处置，三选一标签：`[ACTION:收编]` / `[ACTION:判死]` / `[ACTION:挂起]` | 任务描述"本刀不做交互" |
| I5 | CI 闸必须 proven-to-fire：无 import 的新孤岛文件必须让闸红；正常带 import 的新文件必须让闸绿 | thin_prd E2E |
| I6 | 不改动 `packages/brain/src/routes/graph.js`（刀A2 已封）；新逻辑落在 CI script 和 nightly job 步骤中 | 边界规则 |

---

## 累积 FR

| FR# | 功能需求 | 验收断言 |
|-----|---------|---------|
| FR1 | **CI 孤岛闸**：PR 新增 `packages/brain/src/**` 文件时，在 ubuntu-latest runner 跑全量 migrate + 局部 scan（仅新增文件）+ island-check 等价判定 | 孤岛文件 → `exit 1`；带 import 文件 → `exit 0` |
| FR2 | **CI 闸存量豁免**：`git diff --diff-filter=A` 过滤，修改/重命名文件不触发孤岛判定 | 修改存量文件的 PR 闸绿 |
| FR3 | **CI 闸日志提示**：对判定为 `connected_unclaimed` 的新增文件，日志打 `[ACTION:收编/判死/挂起] <path>`（启发式：测试文件→挂起，src 核心→收编，否则→挂起） | 日志含三选一标签 |
| FR4 | **nightly 无主统计**：在 `integration-nightly.yml` 或专属 nightly step 中，调 `island-check` 等价逻辑统计 `graph_edges` 覆盖节点中不在任何 covered 认领域的节点比例，写入巡检产物（JSONL 行）| nightly 产物含 `unclaimed_ratio` 字段 |
| FR5 | **nightly 棘轮告警**：读取历史最高 `unclaimed_ratio`（Brain KV 或产物文件），当日比例 > 历史最高 → 开 `[claim-ratchet-red]` GitHub Issue | Issue 在比例上升时存在，不上升时不开 |
| FR6 | **radius/island-check 响应提示**（可选增强，不阻 E2E）：两端点响应体中对 `verdict=connected_unclaimed` 节点附加 `hint` 字段，值为三选一标签 | `hint` 字段存在于 `connected_unclaimed` 结果 |

> 本刀 FR 数：6（核心 FR1-FR5，增强 FR6）

---

## 技术设计要点

### CI 孤岛闸实现路径

```
packages/brain/scripts/ci/island-gate.mjs
├── 读 git diff --diff-filter=A → 筛 packages/brain/src/**
├── 若无新增文件 → exit 0（skip）
├── 建 cecelia_test（pg service）+ migrate
├── 对新增文件跑 graph-extract（import+spawn+http）
├── 调 graph-query.js buildAdjacency + reachable + buildClaimZones 等价逻辑
└── isolated → console.error + exit 1；否则 exit 0
```

CI job 位置：`brain-ci-deploy.yml` PR 触发的 `skill-contract-guard`（或新增 `island-gate` job）。

### nightly 无主统计路径

```
packages/brain/scripts/ci/unclaimed-ratio.mjs
├── 连真 DB（cecelia_test in nightly）
├── SELECT DISTINCT src_path, dst_path FROM graph_edges WHERE repo='cecelia'
├── buildClaimZones（同 graph-query.js 逻辑）
├── unclaimed_ratio = unclaimed_nodes / total_nodes
├── 读 Brain KV: GET /kv/claim_ratchet_max
├── 写 JSONL 巡检行 → /tmp/unclaimed-ratio.jsonl
└── 若当日 > 历史最高 → POST Brain KV 更新 + gh issue create [claim-ratchet-red]
```

### 踩无主提示分类规则（启发式，无需 LLM）

```
path 含 __tests__/  或 .test. / .spec. → [ACTION:挂起]
path 含 /src/       且不含 test         → [ACTION:收编]
其他                                      → [ACTION:挂起]
```

---

## E2E 验收（proven-to-fire）

| # | 场景 | 操作 | 期望 |
|---|------|------|------|
| E1 | **孤岛新文件 → 闸红** | PR 中新增 `packages/brain/src/orphan-test-fixture.js`（无任何 import/spawn/http） | CI island-gate job `exit 1`，PR checks 红 |
| E2 | **正常新文件 → 闸绿** | PR 中新增 `packages/brain/src/legit-fixture.js`（含 `import pool from '../db.js'`） | CI island-gate job `exit 0`，PR checks 绿 |
| E3 | **nightly 产物含无主比例** | 触发 nightly（`workflow_dispatch`） | 产物 JSONL 含 `unclaimed_ratio: <number>`，0 ≤ ratio ≤ 1 |
| E4 | **棘轮 proven-to-fire（可手动验）** | nightly 传入 `fire_test=1` 参数 → 强制 ratio=1.0 | `[claim-ratchet-red]` Issue 被创建 |

---

## NFR

| 类型 | 要求 |
|------|------|
| 性能 | island-gate CI step ≤ 3 min（含 migrate 约 30s + scan）|
| 幂等 | `[claim-ratchet-red]` Issue 按日期 title 去重，不重复开 |
| 存量安全 | 存量 `packages/brain/src/**` 文件不参与 island-gate 判定 |
| 可维护 | `island-gate.mjs` 复用 `lib/graph-query.js` 纯函数，不重写逻辑 |
| 可观测 | nightly 产物 JSONL 格式与 `integration-nightly.yml` 现有产物风格对齐 |
| 回滚 | island-gate job 失败不阻塞 deploy job（`needs` 独立，不互相依赖） |

---

## 文件改动清单（预期）

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/scripts/ci/island-gate.mjs` | 新增 | CI 孤岛闸核心脚本 |
| `packages/brain/scripts/ci/unclaimed-ratio.mjs` | 新增 | nightly 无主统计脚本 |
| `.github/workflows/brain-ci-deploy.yml` | 修改 | 添加 island-gate PR job |
| `.github/workflows/nightly-regression.yml` 或 `integration-nightly.yml` | 修改 | 添加 unclaimed-ratio step + 棘轮告警 |
| `packages/brain/src/__tests__/island-gate.test.mjs` | 新增 | E1/E2 单测（proven-to-fire 回归锁） |

---

journey_type: ci_gate_and_nightly_ratchet
target_environment: local_api
