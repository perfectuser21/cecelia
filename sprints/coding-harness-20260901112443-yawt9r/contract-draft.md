# Sprint Contract Draft (Round 1)

## 合同边界与证据来源

- 实现基线：`d4ae8c6d2b777f5762c4cd88a8e8d56004c66750`（整个 Harness 生命周期保持不变）。
- 冻结需求：本 sprint 的 `thin_prd` 与 `sprint-prd.md`；仅允许新增 `docs/current/attempt-run-bridge-guide.md`，不修改代码、配置或既有文档。
- Unified Map：`[MAP_NOT_CONFIGURED]`；task 的 `map_scope` 为空，故没有 `must_run_assertions`、`fact_revisions` 或 freshness 证据可纳入。
- Registry：API、DB、测试 registry 均可读取；本任务没有新 API/DB schema，测试沿用 Vitest `describe/it/expect` 风格。
- contract-gate：启用（`packages/brain/src/lib/contract-gate.js` 存在）。
- gp-anchor：skipped (`product-map.json` not found)。

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明，不新增或修改 HTTP 响应。文档必须按 PRD 字面描述现有两个端点，不得借合同扩展 response key。

## 已知约束（来自回归测试与历史）

- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 对 loopback 与 Bearer 鉴权分支已有回归约束。
- `[累积FR]` 本 line 暂无历史。
- `context-manifest: N/A`：PRD 的 `journey_id` 为 `none`，没有可查询的 line manifest。
- `[MAP_NOT_CONFIGURED]` 无 Unified Map 回归断言；不得用领域硬编码替代。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 四个主题均可由确定性测试解析；唯一产品交付文件位于 `docs/current/`。 |
| Invariant（永不违反） | 不泄露真实 token；不把非 loopback 无 Bearer 描述为可访问；不改任何代码、配置或既有文档。 |
| 判定点（怎么知道） | 文档标题、分节与字面合同由 Vitest/Node 解析；见下表。 |
| 保质期（何时过期） | 当端点鉴权、角色或 payload/回滚合同变化时由对应 Brain 变更同步更新本页。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 缺节、缺字面或出现额外产品变更即失败，由 PR CI 向提交者报告。 |
| 失败语义（挂了怎么办） | 任一断言失败即阻塞合并；不以部分章节存在降级放行。 |
| 效果确认（已发≠已生效） | 以已提交文档的完整内容和基线 diff 为准，不以生成日志或文件存在单独判定。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺任一必需主题或字面 | 测试非零退出并阻塞合并 | 是，修正文档后重跑 | 无降级 |
| diff 出现范围外产品文件 | E2E 非零退出并阻塞合并 | 是，移除越界变更后重跑 | 无降级 |
| 文档包含疑似真实 Bearer 值 | 测试非零退出并阻塞合并 | 是，改为环境变量占位后重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## 真实调用方请求 shape

本任务不改变调用方 shape；文档示例必须保持以下生产同形合同：

- 非 loopback 的宿主/远端调用使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 请求头，禁止把 token 放入 body/query，禁止写入真实值。
- `POST /api/brain/harness/attempt-run` 的 JSON payload 至少含 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
- `GET /api/brain/harness/attempt-run/:id` 的 `id` 位于 path parameter。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；纯文档 sprint 不发起真实 attempt，避免验收改变生产状态。）

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块、生命周期或 DB 写路径，N/A。）

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权与 payload 创建 attempt] → [按 id 查询状态] → [辨别成功或完整失败回滚]

### Step 1: 读者识别两个端点及用途

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 中文文档分别说明 POST 创建并派发 attempt、GET 按 id 查询 attempt-run 状态。

**验证命令**:

```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/POST \/api\/brain\/harness\/attempt-run/.test(s)||!/创建并派发/.test(s)||!/GET \/api\/brain\/harness\/attempt-run\/:id/.test(s)||!/查询/.test(s))process.exit(1)"
```

**硬阈值**: 两个端点字面和各自用途全部出现；上述命令 exit 0。

### Step 2: 读者按正确鉴权和角色白名单发起请求

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2-3 项。

**可观测行为**: 文档说明 `internalAuthOrLoopback`，宿主/远端必须携带 Bearer 环境变量占位，并逐项列出九个冻结角色。

**验证命令**:

```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const roles=['planner','proposer','critic','generator','generator-fix','evaluator','evaluator-fix','judge','reporter'];if(!s.includes('internalAuthOrLoopback')||!s.includes('Authorization: Bearer $CECELIA_INTERNAL_TOKEN')||!roles.every(r=>s.includes('`'+r+'`'))||!/九项角色白名单/.test(s))process.exit(1);if(/Bearer [A-Za-z0-9_-]{24,}/.test(s.replace('Bearer $CECELIA_INTERNAL_TOKEN','')))process.exit(1)"
```

**硬阈值**: 鉴权方式、宿主/远端要求、九项角色恰当说明及无真实 token 泄露；命令 exit 0。

### Step 3: 读者构造 payload 并查询对应 run

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4、6 项。

**可观测行为**: 文档明确三个必填字段，并明确 `base_sha` 可省略、由生产 Brain 自解析；查询示例使用 POST 返回标识作为 GET path id。

**验证命令**:

```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const k of ['sprint_dir','base_repo','branch'])if(!new RegExp('`'+k+'`.{0,40}必填','s').test(s))process.exit(1);if(!/`base_sha`.{0,40}可省略.{0,80}生产 Brain.{0,30}自解析/s.test(s)||!/POST[\s\S]{0,1500}(id|标识)[\s\S]{0,1500}GET/s.test(s))process.exit(1)"
```

**硬阈值**: 三个字段均标为必填，`base_sha` 不得标为必填，且 POST→GET 关联清楚；命令 exit 0。

### Step 4: 读者辨别派发失败后的完整回滚

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5-6 项。

**可观测行为**: 文档在同一失败回滚章节完整说明 run、session、task 三对象终态。

**验证命令**:

```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const n=x=>x.replace(/\s/g,'');const t=n(s);if(!t.includes('run→failed')||!t.includes('session→closed')||!t.includes('task→cancelled')||!/派发失败/.test(s)||!/自动回滚/.test(s))process.exit(1)"
```

**硬阈值**: 三个状态对全部出现且明确属于派发失败自动回滚；命令 exit 0。

## 接缝清单

本任务只产出文档且不执行外部副作用，无真实世界接缝；N/A。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否会把缺少 `sprint_dir`、`base_repo` 或 `branch` 的 body 误称为有效。
- 重复提交: 检查 POST 与 GET 示例多次出现时鉴权和字段合同是否自相矛盾。
- 中途中断: 检查只读到回滚章节一部分时是否会误以为仅需回滚 run。
- 边界值: 检查 `base_sha` 缺省语义是否被任何示例反向写成必填。
发现分级: P0/P1（凭据泄露、错误鉴权或错误回滚合同）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（仓库工作区内执行文档合同，不启动 UI）

```bash
#!/usr/bin/env bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge-guide.md'
BASE_SHA='d4ae8c6d2b777f5762c4cd88a8e8d56004c66750'
test -f "$DOC"
node - <<'NODE'
const fs = require('fs');
const s = fs.readFileSync('docs/current/attempt-run-bridge-guide.md', 'utf8');
const required = [
  'POST /api/brain/harness/attempt-run', 'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback', 'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  'planner', 'proposer', 'critic', 'generator', 'generator-fix',
  'evaluator', 'evaluator-fix', 'judge', 'reporter',
  'sprint_dir', 'base_repo', 'branch', 'base_sha',
  'run', 'failed', 'session', 'closed', 'task', 'cancelled',
];
for (const value of required) if (!s.includes(value)) throw new Error(`缺少合同字面: ${value}`);
if (!/[\u4e00-\u9fff]{20}/.test(s)) throw new Error('文档不是有效中文说明');
if (!/`sprint_dir`.{0,40}必填/s.test(s) || !/`base_repo`.{0,40}必填/s.test(s) || !/`branch`.{0,40}必填/s.test(s)) throw new Error('必填字段标记不完整');
if (!/`base_sha`.{0,40}可省略.{0,80}生产 Brain.{0,30}自解析/s.test(s)) throw new Error('base_sha 缺省语义不完整');
const flat = s.replace(/\s/g, '');
for (const pair of ['run→failed', 'session→closed', 'task→cancelled']) if (!flat.includes(pair)) throw new Error(`回滚状态缺失: ${pair}`);
const scrubbed = s.replaceAll('Bearer $CECELIA_INTERNAL_TOKEN', '');
if (/Bearer\s+[A-Za-z0-9_.-]{24,}/.test(scrubbed)) throw new Error('疑似硬编码真实 token');
NODE
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current)
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: docs/current 产品变更必须且只能是 $DOC，实际=$CHANGED"; exit 1; }
CODE_CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- packages apps scripts | wc -l | tr -d ' ')
[ "$CODE_CHANGED" = 0 ] || { echo 'FAIL: 纯文档 sprint 出现代码变更'; exit 1; }
npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts
echo 'OK: attempt-run 桥接使用说明合同验收通过'
```

**通过标准**: 脚本 exit 0；唯一产品交付文件为指定中文文档，四个主题完整，无代码变更。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档完整合同 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `B-01 两个端点及用途完整`、`B-02 鉴权与九项角色白名单完整`、`B-03 payload 必填与 base_sha 缺省语义完整`、`B-04 派发失败三对象自动回滚完整`、`B-05 中文文档且无真实 token` | 文档尚不存在，5 个测试在读取目标文档时失败 |

