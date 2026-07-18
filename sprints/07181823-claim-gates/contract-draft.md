# Contract Draft — 认领制三闸：island-check 出生有主 + 踩无主提示 + 无主棘轮进 nightly

## 合同 ID
sprint-07181823-claim-gates

## 对应 PRD
sprints/07181823-claim-gates/sprint-prd.md

## Task ID
0bbbadcd-6ebe-4d46-8210-28d8119bceb6

---

## 范围声明

本合同涵盖：
1. **CI 孤岛闸**（`packages/brain/scripts/ci/island-gate.mjs`）：PR 新增 `packages/brain/src/**` 文件时，建临时 `cecelia_test` DB → 全量 migrate → 局部 scan-graph（仅新增文件的 import/spawn/http 边）→ island-check 等价判定 → 孤岛 `exit 1`，否则 `exit 0`
2. **CI 闸存量豁免**：`git diff --diff-filter=A` 仅过滤新增文件，修改/重命名存量文件不触发孤岛判定
3. **CI 闸日志提示**：`connected_unclaimed` 节点打 `[ACTION:收编/判死/挂起]` 标签（启发式规则，无 LLM）
4. **nightly 无主统计**（`packages/brain/scripts/ci/unclaimed-ratio.mjs`）：统计 `graph_edges` 覆盖节点中不在任何 covered 认领域的节点比例，写 JSONL 巡检行
5. **nightly 棘轮告警**：当日 `unclaimed_ratio > 历史最高` → 自动开 `[claim-ratchet-red]` GitHub Issue（按日期去重）
6. **radius/island-check 响应提示**（增强，不阻 E2E）：`verdict=connected_unclaimed` 节点附 `hint` 字段

**不在范围**：
- 修改 `packages/brain/src/routes/graph.js`（刀A2 已封）
- 存量文件主动补录入关系图
- 任何交互式自动处置逻辑

---

## 约束重申（来自 PRD Invariants）

| # | 约束 |
|---|------|
| I1 | CI 闸只检查 `git diff --diff-filter=A` 过滤出的**新增**文件（`packages/brain/src/**`），存量豁免 |
| I2 | CI 内建临时 cecelia_test DB → migrate → scan-graph（仅本分支新增文件）→ island-check 等价判定 |
| I3 | nightly 棘轮：当日比例 > 历史最高 → 开 `[claim-ratchet-red]` Issue；只降不升 |
| I4 | 踩无主提示仅写日志/响应，不做交互不自动处置 |
| I5 | CI 闸 proven-to-fire：孤岛新文件 → exit 1；带 import 新文件 → exit 0 |
| I6 | 不改动 `packages/brain/src/routes/graph.js` |

---

## 行为断言（Behavior Assertions）

### B1 — CI 孤岛闸：孤岛新文件 → exit 1（proven-to-fire）

**场景**：PR 新增 `packages/brain/src/orphan-test-fixture.js`，文件内无任何 `import`、`require`、`spawn`、`http` 调用。

**期望行为**：
- `island-gate.mjs` 通过 `git diff --diff-filter=A` 识别出该新增文件
- scan-graph 扫描后无出边无入边 → 节点不在任何 covered 认领域 → verdict = `isolated`
- 脚本 `console.error` 打出文件路径 + `[ISLAND-GATE] FAIL: isolated file detected`
- 脚本 `exit 1`，CI job 红

### B2 — CI 孤岛闸：带 import 新文件 → exit 0（存量豁免 + 正常文件放行）

**场景**：PR 新增 `packages/brain/src/legit-fixture.js`，文件含 `import pool from '../db.js'`。

**期望行为**：
- `island-gate.mjs` 识别新增文件，scan-graph 扫描出 import 边（指向 db.js）
- db.js 已在 graph_edges 中存在，节点通过边连接到图中
- verdict = `connected_unclaimed`（不孤立）
- 脚本 `exit 0`，CI job 绿

### B3 — CI 存量豁免：修改存量文件的 PR 不触发孤岛判定

**场景**：PR 仅修改 `packages/brain/src/tasks.js`（已存在的存量文件），无新增文件。

**期望行为**：
- `git diff --diff-filter=A` 输出空（无新增文件）
- `island-gate.mjs` 检测到无新增文件 → 打印 `[ISLAND-GATE] SKIP: no new files`
- `exit 0`，不触发任何孤岛判定

### B4 — CI 日志提示：connected_unclaimed 打 [ACTION:xxx] 标签

**场景**：PR 新增 `packages/brain/src/utils/helper-new.js`（含 import 但不在任何 covered 认领域）。

**期望行为**：
- 判定为 `connected_unclaimed`（在图中但无主）
- 文件路径匹配 `/src/`（非测试） → 日志打 `[ACTION:收编] packages/brain/src/utils/helper-new.js`
- exit 0（connected_unclaimed 不阻 CI）

### B5 — CI 日志提示：测试文件打 [ACTION:挂起]

**场景**：PR 新增 `packages/brain/src/__tests__/new-feature.test.mjs`（含 import 但无主）。

**期望行为**：
- 判定为 `connected_unclaimed`
- 文件路径含 `__tests__` → 日志打 `[ACTION:挂起] packages/brain/src/__tests__/new-feature.test.mjs`

### B6 — nightly 产物含 unclaimed_ratio 字段

**场景**：`integration-nightly.yml` 或 nightly 触发，执行 `unclaimed-ratio.mjs`。

**期望行为**：
- 脚本连真 DB（cecelia_test），查 `graph_edges`，计算 unclaimed_ratio
- 产物写入 `/tmp/unclaimed-ratio.jsonl`，每行含 `{ "date": "...", "unclaimed_ratio": <0-1>, "total_nodes": <n>, "unclaimed_nodes": <n> }`
- ratio 值范围 `[0, 1]`

### B7 — nightly 棘轮：比例上升 → 开 [claim-ratchet-red] Issue

**场景**：`workflow_dispatch` 触发时传入 `fire_test=1`（强制 ratio=1.0）。

**期望行为**：
- 当日 ratio（1.0）> 历史最高 → 调 `gh issue create` 创建 `[claim-ratchet-red]` Issue
- Issue title 含日期（按日期去重：同名 open issue 已存在则跳过）
- KV 更新 `claim_ratchet_max` = 1.0

### B8 — nightly 棘轮幂等：同日重跑不重复开 Issue

**场景**：同一天内 nightly 因故重跑两次，比例均 > 历史最高。

**期望行为**：
- 第一次跑：开 Issue，title 含 `今日日期`
- 第二次跑：检测到已有同名 open Issue → 跳过，不重复创建

---

## Golden Path

[PR 新增 `packages/brain/src/` 文件]
→ [CI island-gate job 自动触发]
→ [无 import 孤岛文件 → exit 1 红；有 import 文件 → exit 0 绿；存量修改文件 → 豁免绿]
→ [nightly 跑完 → 产物 JSONL 含 unclaimed_ratio]
→ [若比例上升 → 开 [claim-ratchet-red] Issue（日期去重）]

---

## E2E 验收

target_environment: github_ci + local_api（nightly 棘轮部分）

### E1 — 孤岛新文件 → CI 闸红（proven-to-fire）

**操作**：PR 中新增 `packages/brain/src/orphan-test-fixture.js`（无任何 import/spawn/http）

**验收断言**：
- CI `island-gate` job 以 `exit 1` 结束
- job 日志含 `[ISLAND-GATE] FAIL` 或 `isolated`
- PR checks 状态红

**手动本地验证命令**：
```bash
# 在本地模拟 CI 孤岛闸（需要本地 cecelia_test DB 已 migrate）
cat > /tmp/orphan-test-fixture.js << 'EOF'
// 无任何 import，intentionally orphan
export function noop() {}
EOF
ADDED_FILES="/tmp/orphan-test-fixture.js" \
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia_test DB_USER=cecelia \
  node packages/brain/scripts/ci/island-gate.mjs --fixture-files="packages/brain/src/orphan-test-fixture.js"
echo "exit code: $?"  # 期望: 1
```

### E2 — 正常新文件 → CI 闸绿

**操作**：PR 中新增 `packages/brain/src/legit-fixture.js`（含 `import pool from '../db.js'`）

**验收断言**：
- CI `island-gate` job 以 `exit 0` 结束
- PR checks 绿

**手动本地验证命令**：
```bash
# 在本地模拟 CI，带 import 的新文件应通过
cat > /tmp/legit-fixture.js << 'EOF'
import pool from '../db.js';
export async function query(sql) { return pool.query(sql); }
EOF
ADDED_FILES="packages/brain/src/legit-fixture.js" \
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia_test DB_USER=cecelia \
  node packages/brain/scripts/ci/island-gate.mjs --fixture-files="packages/brain/src/legit-fixture.js"
echo "exit code: $?"  # 期望: 0
```

### E3 — nightly 产物含无主比例

**操作**：GitHub Actions `workflow_dispatch` 触发 nightly，或本地直接跑 unclaimed-ratio.mjs

**验收断言**：
- 产物 JSONL 文件（`/tmp/unclaimed-ratio.jsonl` 或 CI artifacts）含至少 1 行
- 每行含 `unclaimed_ratio` 字段，值为 float，范围 `[0, 1]`

**手动本地验证命令**：
```bash
# 本地跑 unclaimed-ratio.mjs，连本地 cecelia DB
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia DB_USER=cecelia \
  node packages/brain/scripts/ci/unclaimed-ratio.mjs --output /tmp/unclaimed-ratio.jsonl
# 校验产物
cat /tmp/unclaimed-ratio.jsonl | node -e "
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let lines = 0;
rl.on('line', (line) => {
  lines++;
  const obj = JSON.parse(line);
  const ratio = obj.unclaimed_ratio;
  if (typeof ratio !== 'number' || ratio < 0 || ratio > 1) {
    console.error('FAIL: unclaimed_ratio 不合法:', ratio);
    process.exit(1);
  }
  console.log('OK: unclaimed_ratio =', ratio, 'total_nodes =', obj.total_nodes);
});
rl.on('close', () => {
  if (lines === 0) { console.error('FAIL: JSONL 为空'); process.exit(1); }
  console.log('PASS: unclaimed_ratio 字段存在且有效，共', lines, '行');
});
"
```

### E4 — 棘轮 proven-to-fire（fire_test=1）

**操作**：nightly `workflow_dispatch` 传 `fire_test=1` → 强制 ratio=1.0

**验收断言**：
- `[claim-ratchet-red]` GitHub Issue 被创建（或已存在同日 open Issue）
- Issue title 含当日日期

**手动本地验证命令**：
```bash
# 本地 proven-to-fire：传 --fire-test 强制 ratio=1.0
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia DB_USER=cecelia \
BRAIN_URL=http://localhost:5221 \
  node packages/brain/scripts/ci/unclaimed-ratio.mjs --fire-test --output /tmp/unclaimed-ratio-fire.jsonl
# 校验：JSONL ratio=1.0
cat /tmp/unclaimed-ratio-fire.jsonl | python3 -c "
import sys, json
lines = [json.loads(l) for l in sys.stdin if l.strip()]
assert lines, 'FAIL: JSONL 为空'
assert lines[0]['unclaimed_ratio'] == 1.0, f'FAIL: ratio={lines[0][\"unclaimed_ratio\"]} 不是 1.0'
print('PASS: fire_test 强制 ratio=1.0 OK')
"
# 注意：GitHub Issue 创建需要 GH_TOKEN，本地验证仅验 ratio，Issue 创建由 CI 验证
```

---

## 文件改动清单（本合同约束范围）

| 文件 | 操作 | 约束 |
|------|------|------|
| `packages/brain/scripts/ci/island-gate.mjs` | 新增 | 复用 `src/lib/graph-query.js` 纯函数，不重写逻辑 |
| `packages/brain/scripts/ci/unclaimed-ratio.mjs` | 新增 | 复用 buildAdjacency/buildClaimZones 逻辑 |
| `.github/workflows/brain-ci-deploy.yml` | 修改 | 添加 island-gate PR job，island-gate 失败不阻 deploy job |
| `.github/workflows/integration-nightly.yml` | 修改 | 添加 unclaimed-ratio step + 棘轮告警 |
| `packages/brain/src/__tests__/island-gate.test.mjs` | 新增 | proven-to-fire 回归锁，E1/E2 对应单测 |

**不允许修改**：`packages/brain/src/routes/graph.js`

---

## 领域验证规则

- **CI 域**：island-gate.mjs 必须对孤岛新文件 exit 1，对连通新文件 exit 0，对无新增文件 exit 0（三态全覆盖）
- **nightly 域**：unclaimed_ratio 字段类型 float，范围 [0,1]；JSONL 格式与 integration-nightly.yml 现有产物对齐
- **棘轮域**：Issue 按 `今日日期` 去重，不重复创建；fire_test=1 时必须触发
- **日志提示域**：`[ACTION:xxx]` 标签必须出现在 CI 日志中，三种标签（收编/判死/挂起）启发式规则固化不变
- **边界域**：I6 不变量——graph.js 不触碰
