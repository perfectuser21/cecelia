# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务仅新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与历史输入）

- `[packages/brain/src/routes/__tests__/harness-attempt-run.test.js]` → 路由必须暴露 `/attempt-run` 与 `/attempt-run/:attemptId`（仅作为现状依据，本 Sprint 不改代码）。
- `[packages/brain/src/middleware/internal-auth.test.js]` → `internalAuthOrLoopback` 区分 loopback 与远端鉴权（仅作为现状依据）。
- `[累积FR]` 本 line 暂无历史。
- `[MAP_NOT_CONFIGURED]` task 未配置 `map_scope/map_repo`，不从目录推断影响半径；`must_run_assertions` 为空。
- 实现基线固定为 `5599211397c88c3827d5ce4e9c6061b3802b4fc5`；角色 checkout 基线不得替代它。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增 `docs/current/attempt-run-bridge-guide.md`，准确说明端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 中文、四节齐全、九项角色恰好列全；不修改任何产品代码或其他文档。 |
| Invariant（永不违反） | 不写真实 token；不把远端匿名请求描述为可用；不改变现有实现。 |
| 判定点（怎么知道） | 以冻结 PRD 的字面术语和自动化文档断言判定。 |
| 保质期（何时过期） | 当 attempt-run 端点契约变化时由对应代码变更同步更新本文档。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 在内容缺失或实现 diff 越界时失败并阻塞合入。 |
| 失败语义（挂了怎么办） | 任一必需章节、术语、角色或终态缺失即失败，不降级放行。 |
| 效果确认（已发≠已生效） | 在候选 HEAD 读取文档并逐项断言，同时对实现基线做仓库差异白名单校验。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不全 | 验收命令非零退出，阻塞合入 | 是，修正文档后重跑 | 无降级 |
| 实现基线后的非许可文件发生变化 | 仓库差异断言非零退出，阻塞合入 | 是，移除越界改动后重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [核对端点与鉴权] → [构造合法 payload] → [查询状态并识别失败收口]

### Step 1: 找到说明并识别两个桥接端点
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 读者在中文文档中看到 POST 用于创建并派发 attempt，GET 用于按 id 查询 attempt 状态。

**硬阈值**: 文件位于指定路径，标题与两个端点用途均明确。

**验证命令**: `node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!c.includes('attempt-run 桥接使用说明')||!c.includes('POST /api/brain/harness/attempt-run')||!c.includes('创建并派发')||!c.includes('GET /api/brain/harness/attempt-run/:id')||!c.includes('按 id 查询'))process.exit(1)"`

### Step 2: 选择正确鉴权并核对角色
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2、3 项。

**可观测行为**: 读者看到两端点均使用 `internalAuthOrLoopback`，宿主/远端必须携带 Bearer 环境变量，并看到恰好九项角色白名单。

**硬阈值**: 不出现真实 token；角色集合恰好为 PRD 给出的九项。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t '鉴权与九项角色白名单'`

### Step 3: 按字段约束构造 POST payload
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 读者看到 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**硬阈值**: 四个字段的必填/可省略语义不得反转。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填字段与 base_sha 省略语义'`

### Step 4: 查询 attempt 并识别派发失败收口
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项与「范围限定」。

**可观测行为**: 读者能依据 `run→failed`、`session→closed`、`task→cancelled` 确认派发失败已完整收口，并且交付没有越界修改代码。

**硬阈值**: 三个终态全部出现；实现基线后的非 Sprint 合同产物差异恰好只有目标文档。

**验证命令**: `bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; grep -q "run.*failed" "$DOC" && grep -q "session.*closed" "$DOC" && grep -q "task.*cancelled" "$DOC"; mapfile -t changed < <(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD | grep -v "^sprints/coding-harness-20260901093400-iof74k/"); [ "${#changed[@]}" -eq 1 ] && [ "${changed[0]}" = "$DOC" ]'`

## 真实调用方请求 shape

N/A — 文档描述既有调用方式，但本 Sprint 不新增或修改设备/agent 到服务端的请求 shape；字面契约以冻结 PRD 为准。

## 禁 mock 边清单

（本单为纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（纯文档交付无真实世界接缝，N/A。）

gp-anchor: skipped (product-map.json not found)

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=5599211397c88c3827d5ce4e9c6061b3802b4fc5
SPRINT_DIR=sprints/coding-harness-20260901093400-iof74k
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('node:fs');
const c = fs.readFileSync(process.argv[2], 'utf8');
const required = [
  'attempt-run 桥接使用说明',
  'POST /api/brain/harness/attempt-run',
  'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback',
  'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  'sprint_dir', 'base_repo', 'branch', 'base_sha',
  'run→failed', 'session→closed', 'task→cancelled',
];
for (const text of required) if (!c.includes(text)) throw new Error(`缺少: ${text}`);
const expectedRoles = ['planner','proposer','critic','generator','generator-fix','evaluator','evaluator-fix','judge','reporter'];
const roleSection = c.match(/## 角色白名单([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
const actualRoles = [...roleSection.matchAll(/`([^`]+)`/g)].map(m => m[1]);
if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) throw new Error(`角色白名单不准确: ${JSON.stringify(actualRoles)}`);
if (!/base_sha[^\n]*(可省略|省略)[^\n]*生产 Brain[^\n]*自解析/.test(c)) throw new Error('base_sha 省略语义缺失');
NODE
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
mapfile -t changed < <(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^$SPRINT_DIR/")
[ "${#changed[@]}" -eq 1 ] || { printf 'FAIL: 非合同产物差异应恰好为 1，实际为 %s\n' "${#changed[@]}"; printf '%s\n' "${changed[@]}"; exit 1; }
[ "${changed[0]}" = "$DOC" ] || { printf 'FAIL: 越界差异 %s\n' "${changed[0]}"; exit 1; }
echo 'OK: attempt-run 桥接说明与 docs-only 差异验收通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 搜索文档是否误称远端无 token 也可调用。
- 重复提交: 核对九项角色是否重复、遗漏或混入额外角色。
- 中途中断: N/A（静态文档无中断态）。
- 边界值: 核对 `base_sha` 省略语义与三个失败终态是否完整。
发现分级: P0/P1（凭据泄露、错误鉴权或错误终态）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 桥接说明冻结测试 | `sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途`；`鉴权与九项角色白名单`；`payload 必填字段与 base_sha 省略语义`；`派发失败自动回滚三类终态` | 目标文档尚不存在，4 个测试均因 ENOENT 失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 本 Sprint 的 `tests/`、合同和 task plan 是 Harness 冻结产物；仓库范围的 docs-only 断言明确排除本 Sprint 冻结目录后，仍以权威实现基线校验候选实现差异，避免合同自身造成确定性假失败。

