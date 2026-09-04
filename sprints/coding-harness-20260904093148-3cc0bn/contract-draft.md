# Sprint Contract Draft (Round 1)

task_request_hash: 541dc1728c1cd6aed31701812cd4e8bdc2a35773bcaf39af521e12d23c1c7b7d

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增使用说明文档，无 HTTP 响应或 API 行为变更。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单固定为九项，且不含 commander/publisher。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 区分 loopback 与需 token 的请求。
- [累积FR] 本 line 暂无历史。
- [MAP_NOT_CONFIGURED] task payload 未配置 map_scope/map_repo；不回退到领域硬编码。

## Golden Path

独立小路（无父路）

[读者打开说明] → [识别创建与查询端点] → [按来源完成鉴权] → [选合法角色并组装 payload] → [理解失败回滚终态]

### Step 1: 找到并打开中文说明

**来源**: `[FROM_PRD]` — PRD「范围限定」要求仅在 `docs/current/` 新增一页中文使用说明。

**可观测行为**: 读者可在 `docs/current/attempt-run-bridge-guide.md` 阅读中文标题《attempt-run 桥接使用说明》。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!s.includes('# attempt-run 桥接使用说明')||!/[一-鿿]/.test(s))process.exit(1)"
```

**硬阈值**: 文件存在、标题匹配且至少包含一个中文字符；以上命令 exit 0。

### Step 2: 区分两个端点用途与鉴权

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、2 项。

**可观测行为**: 文档分别说明 `POST /api/brain/harness/attempt-run` 用于异步创建/派发单角色 attempt，`GET /api/brain/harness/attempt-run/:id` 用于轮询查询结构化结果；鉴权明确为 `internalAuthOrLoopback`，宿主/远端携带 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Authorization: Bearer CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 四个合同字面值全部出现；以上命令 exit 0。

### Step 3: 组装合法角色与 payload

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3、4 项；角色名称逐字取自生产 `ALLOWED_ROLES`。

**可观测行为**: 文档无省略地列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`；说明 payload 必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge','sprint_dir','base_repo','branch','base_sha','生产 Brain 自解析'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 九项角色与四个字段逐字齐全，并明确 `base_sha` 的省略语义；以上命令 exit 0。

### Step 4: 判断派发失败后的终态

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项。

**可观测行为**: 文档明确派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 三类资源及终态全部逐字出现；以上命令 exit 0。

## 真实调用方请求 shape

N/A — 本 sprint 不修改或调用端点，只记录生产调用合同；文档中的鉴权 header 和 payload 字段须与生产路由逐字一致。

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写路径变更，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单不执行生产端点，只验文档与生产源码合同一致，无待真目标验收接缝，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增 attempt-run 桥接中文说明，覆盖 PRD 指定四节。 |
| NFR（做得多好） | 关键端点、角色、字段和终态均可由确定性检查逐字验证。 |
| Invariant（永不违反） | 仅新增一页文档；不改代码；不硬编码 token 值；实现基线保持 `033e0feae6474eff023a3974a94a17ad0a6a53b9`。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 生产路由合同变化时文档需同步更新。 |
| 死亡告警（停了谁知道） | 冻结测试在 Sprint Tests 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一必需字面约束缺失即验收失败，不放行。 |
| 效果确认（已发≠已生效） | 读取最终文档并逐项核对四节，而非只检查文件存在。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或必需内容缺失 | 测试非零退出并阻塞合并 | 是 | 不降级，不接受省略表达 |
| 修改超出 docs/current 单页 | diff 范围检查失败 | 是 | 删除越界修改后重新验收 |

### 输入对抗面

N/A — 不新增对外 agent 或输入接口。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 本合同的实现基线固定为 `033e0feae6474eff023a3974a94a17ad0a6a53b9`；角色 checkout SHA 不替换该基线。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge-guide.md'
SPRINT='sprints/coding-harness-20260904093148-3cc0bn'
HASH='541dc1728c1cd6aed31701812cd4e8bdc2a35773bcaf39af521e12d23c1c7b7d'
node - "$DOC" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
const s = fs.readFileSync(p, 'utf8');
const groups = [
  ['端点与鉴权', ['POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id', 'internalAuthOrLoopback', 'Authorization: Bearer CECELIA_INTERNAL_TOKEN']],
  ['九项角色', ['canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix', 'evaluator', 'evaluator-evidence-repair', 'judge']],
  ['payload', ['sprint_dir', 'base_repo', 'branch', 'base_sha', '生产 Brain 自解析']],
  ['失败回滚', ['run→failed', 'session→closed', 'task→cancelled']],
];
if (!s.includes('# attempt-run 桥接使用说明') || !/[\u4e00-\u9fff]/.test(s)) throw new Error('文档标题或中文正文缺失');
for (const [name, values] of groups) for (const value of values) if (!s.includes(value)) throw new Error(`${name} 缺少 ${value}`);
NODE
npx vitest run --no-cache "$SPRINT/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
test "$(git diff --name-only 033e0feae6474eff023a3974a94a17ad0a6a53b9...HEAD | grep -vE '^(docs/current/attempt-run-bridge-guide\.md|sprints/coding-harness-20260904093148-3cc0bn/)' | wc -l | tr -d ' ')" -eq 0
grep -Fq "$HASH" "$SPRINT/contract-draft.md"
grep -Fq "$HASH" "$SPRINT/contract-dod.md"
echo 'attempt-run 桥接说明 E2E 验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts` | `包含两个端点用途与鉴权约束`；`完整列出九项角色白名单`；`说明 payload 必填字段与 base_sha 省略语义`；`说明派发失败的三资源回滚终态` | 目标文档尚不存在，4 个测试均因读取失败而 RED |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把远端写成可免鉴权。
- 重复提交: 检查九项角色是否因名称前缀包含关系而被误计数。
- 中途中断: N/A，静态文档无中断状态。
- 边界值: 检查 `base_sha` 是否被误写为必填，或回滚仅覆盖部分资源。
发现分级: P0/P1（凭据泄露或错误鉴权指导）阻塞 merge；P2/P3 记录 findings。
