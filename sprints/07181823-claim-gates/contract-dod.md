# Contract DoD — claim-gates

## Sprint
07181823-claim-gates

## DoD 条目

### [BEHAVIOR] B1 — CI 孤岛闸：孤岛新文件 → exit 1（proven-to-fire）

**验收断言**：
- `island-gate.mjs` 扫描无 import/spawn/http 边的新增文件
- 该文件不在任何 covered 认领域的可达集合内 → verdict = `isolated`
- 脚本日志含 `[ISLAND-GATE] FAIL` 字样 + 文件路径
- 进程以 exit code 1 退出

```bash
# manual:bash — 验证 B1（本地需要 cecelia_test DB + 全量 migrate）
cd /workspace
# 建临时孤岛测试文件（无 import）
cat > /tmp/_orphan_ci_fixture.js << 'EOF'
// intentionally orphan — no import, no spawn, no http
export function noop() {}
EOF

# 复制到 brain/src 让 island-gate 识别为新增文件
cp /tmp/_orphan_ci_fixture.js packages/brain/src/_orphan_ci_fixture.js

# 运行闸（--fixture-files 模拟 git diff 输出）
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia_test DB_USER=cecelia \
  node packages/brain/scripts/ci/island-gate.mjs \
    --fixture-files="packages/brain/src/_orphan_ci_fixture.js" 2>&1
EXIT_CODE=$?

# 清理
rm -f packages/brain/src/_orphan_ci_fixture.js

echo "exit code: $EXIT_CODE"
[ "$EXIT_CODE" -eq 1 ] || { echo "FAIL: 期望 exit 1，实际 $EXIT_CODE"; exit 1; }
echo "B1 PASS"
```

---

### [BEHAVIOR] B2 — CI 孤岛闸：带 import 新文件 → exit 0（正常放行）

**验收断言**：
- `island-gate.mjs` 扫描含 `import pool from '../db.js'` 的新增文件
- scan-graph 提取出 import 边，节点连接到图（db.js 已在 graph_edges 中）
- verdict = `connected_unclaimed`（不孤立）
- 进程以 exit code 0 退出

```bash
# manual:bash — 验证 B2（本地需要 cecelia_test DB + 全量 migrate + graph_edges 含 db.js）
cd /workspace
# 建临时合规测试文件（含 import）
cat > packages/brain/src/_legit_ci_fixture.js << 'EOF'
import pool from '../db.js';
export async function query(sql) { return pool.query(sql); }
EOF

# 运行闸
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia_test DB_USER=cecelia \
  node packages/brain/scripts/ci/island-gate.mjs \
    --fixture-files="packages/brain/src/_legit_ci_fixture.js" 2>&1
EXIT_CODE=$?

# 清理
rm -f packages/brain/src/_legit_ci_fixture.js

echo "exit code: $EXIT_CODE"
[ "$EXIT_CODE" -eq 0 ] || { echo "FAIL: 期望 exit 0，实际 $EXIT_CODE"; exit 1; }
echo "B2 PASS"
```

---

### [BEHAVIOR] B3 — CI 存量豁免：无新增文件 → exit 0 跳过

**验收断言**：
- `git diff --diff-filter=A` 输出为空（PR 仅修改存量文件）
- `island-gate.mjs` 检测到无新增文件 → 打印 `[ISLAND-GATE] SKIP` 并 exit 0
- 不触发任何 DB 连接或 scan-graph 操作

```bash
# manual:bash — 验证 B3（模拟无新增文件场景）
cd /workspace
# 用 --fixture-files="" 模拟 git diff 无新增文件输出
node packages/brain/scripts/ci/island-gate.mjs --fixture-files="" 2>&1
EXIT_CODE=$?
echo "exit code: $EXIT_CODE"
[ "$EXIT_CODE" -eq 0 ] || { echo "FAIL: 无新增文件时期望 exit 0，实际 $EXIT_CODE"; exit 1; }
echo "B3 PASS"
```

---

### [BEHAVIOR] B4 — CI 日志提示：connected_unclaimed 文件打正确 [ACTION:xxx] 标签

**验收断言**：
- `/src/` 路径（非测试）的 `connected_unclaimed` 文件 → 日志打 `[ACTION:收编] <path>`
- `__tests__/` 或 `.test.` 路径的 `connected_unclaimed` 文件 → 日志打 `[ACTION:挂起] <path>`
- 标签三选一（收编/判死/挂起），使用启发式规则（无 LLM）：
  - `path 含 __tests__/ 或 .test. 或 .spec.` → `[ACTION:挂起]`
  - `path 含 /src/ 且不含 test` → `[ACTION:收编]`
  - 其他 → `[ACTION:挂起]`

```bash
# manual:bash — 验证 B4 日志提示（单元测试级别验证）
cd /workspace/packages/brain
# 运行 island-gate 单测（覆盖 action-hint 逻辑）
npx vitest run src/__tests__/island-gate.test.mjs --reporter=verbose 2>&1 | grep -E "action.hint|ACTION|PASS|FAIL|✓|×"
echo "exit: $?"
```

---

### [BEHAVIOR] B5 — nightly 产物 JSONL 含 unclaimed_ratio 字段（0≤ratio≤1）

**验收断言**：
- `unclaimed-ratio.mjs` 执行后，输出 JSONL 每行含 `unclaimed_ratio`（float, 0-1）
- 同时含 `date`（ISO 日期串）、`total_nodes`（int）、`unclaimed_nodes`（int）
- `unclaimed_nodes <= total_nodes`（逻辑一致性）

```bash
# manual:bash — 验证 B5（连本地 cecelia DB）
cd /workspace
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia DB_USER=cecelia \
  node packages/brain/scripts/ci/unclaimed-ratio.mjs \
    --output /tmp/unclaimed-ratio-b5.jsonl 2>&1

echo "--- JSONL 内容 ---"
cat /tmp/unclaimed-ratio-b5.jsonl

node -e "
const fs = require('fs');
const lines = fs.readFileSync('/tmp/unclaimed-ratio-b5.jsonl', 'utf8').trim().split('\n').filter(Boolean);
if (lines.length === 0) { console.error('FAIL: JSONL 为空'); process.exit(1); }
for (const line of lines) {
  const obj = JSON.parse(line);
  const { unclaimed_ratio, date, total_nodes, unclaimed_nodes } = obj;
  if (typeof unclaimed_ratio !== 'number' || unclaimed_ratio < 0 || unclaimed_ratio > 1) {
    console.error('FAIL: unclaimed_ratio 不合法:', unclaimed_ratio); process.exit(1);
  }
  if (!date) { console.error('FAIL: 缺 date 字段'); process.exit(1); }
  if (typeof total_nodes !== 'number') { console.error('FAIL: 缺 total_nodes'); process.exit(1); }
  if (unclaimed_nodes > total_nodes) { console.error('FAIL: unclaimed_nodes > total_nodes'); process.exit(1); }
  console.log('OK:', { date, unclaimed_ratio, total_nodes, unclaimed_nodes });
}
console.log('B5 PASS');
"
```

---

### [BEHAVIOR] B6 — nightly 棘轮：fire_test=1 时开 [claim-ratchet-red] Issue

**验收断言**：
- `--fire-test` 模式下，脚本强制 ratio=1.0
- 1.0 > 历史最高（初始为 0）→ 触发 `gh issue create`
- Issue title 格式：`[claim-ratchet-red] 无主比例上升 — YYYY-MM-DD`
- 同日已有 open Issue → 去重跳过，不重复创建

```bash
# manual:bash — 验证 B6 proven-to-fire（需要 GH_TOKEN 和 gh CLI）
cd /workspace
GH_TOKEN="${GH_TOKEN:-$(cat ~/.credentials/github.env 2>/dev/null | grep GH_PAT | cut -d= -f2 || echo '')}"
BRAIN_URL=http://localhost:5221 \
DB_HOST=localhost DB_PORT=5432 DB_NAME=cecelia DB_USER=cecelia \
GH_TOKEN="$GH_TOKEN" \
  node packages/brain/scripts/ci/unclaimed-ratio.mjs \
    --fire-test \
    --output /tmp/unclaimed-ratio-fire.jsonl \
    --dry-run-issue 2>&1
# --dry-run-issue: 不真实创建 Issue，只打印 Issue 内容到 stdout

# 校验 ratio=1.0 出现在输出
grep -q '"unclaimed_ratio":1' /tmp/unclaimed-ratio-fire.jsonl \
  || { echo "FAIL: fire_test 未强制 ratio=1.0"; exit 1; }
echo "B6 PASS (--dry-run-issue 模式)"
```

---

### [BEHAVIOR] B7 — island-gate CI job 独立于 deploy job（失败不阻部署）

**验收断言**：
- `brain-ci-deploy.yml` 中 `island-gate` job 和 `deploy` job 的 `needs` 互不依赖
- island-gate 失败时，deploy job（push 触发）不受影响
- island-gate 仅在 PR 触发（`github.event_name == 'pull_request'`）

```bash
# manual:bash — 验证 B7（静态 YAML 检查）
cd /workspace
python3 -c "
import yaml, sys
with open('.github/workflows/brain-ci-deploy.yml') as f:
    wf = yaml.safe_load(f)
jobs = wf.get('jobs', {})

# island-gate job 必须存在
assert 'island-gate' in jobs, 'FAIL: island-gate job 不存在'

# deploy job 的 needs 不得含 island-gate
deploy_needs = jobs.get('deploy', {}).get('needs', [])
if isinstance(deploy_needs, str): deploy_needs = [deploy_needs]
assert 'island-gate' not in deploy_needs, f'FAIL: deploy job needs 含 island-gate: {deploy_needs}'

# island-gate 有 PR 条件
gate_if = jobs.get('island-gate', {}).get('if', '')
assert 'pull_request' in gate_if, f'FAIL: island-gate 无 PR 条件限制: {gate_if}'

print('B7 PASS: island-gate 独立于 deploy，不阻部署')
"
```

---

### [BEHAVIOR] B8 — 单元测试：island-gate proven-to-fire 回归锁

**验收断言**：
- `packages/brain/src/__tests__/island-gate.test.mjs` 文件存在
- 测试文件覆盖：孤岛文件 exit 1、带 import 文件 exit 0、无新增文件 exit 0、action-hint 标签三分类
- `npx vitest run` 该测试文件全部 PASS

```bash
# manual:bash — 验证 B8 单元测试全绿
cd /workspace/packages/brain
npx vitest run src/__tests__/island-gate.test.mjs --reporter=verbose 2>&1
echo "vitest exit: $?"
```

---

## 完成标准总结

| 条目 | 描述 | 验证方式 |
|------|------|----------|
| B1 | 孤岛新文件 → exit 1 | unit test + manual:bash |
| B2 | 带 import 新文件 → exit 0 | unit test + manual:bash |
| B3 | 无新增文件 → exit 0 跳过 | unit test + manual:bash |
| B4 | connected_unclaimed 打 [ACTION:xxx] 标签 | unit test + manual:bash |
| B5 | nightly JSONL 含 unclaimed_ratio [0,1] | manual:bash |
| B6 | fire_test=1 触发棘轮告警 | manual:bash (--dry-run-issue) |
| B7 | island-gate 不阻 deploy job | YAML 静态检查 |
| B8 | proven-to-fire 回归单测全绿 | npx vitest run |
