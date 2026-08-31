# Sprint Contract Draft (Round 1)

task_request_hash: `fb7e86a156d48c9d342f74c8feee26cf570d7fed705eb39c86b41cd320c73050`

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [PRD Invariant] 两个端点继续使用 `internalAuthOrLoopback`，文档不得暗示远端匿名访问。
- [PRD Invariant] 不展示真实 token，只展示 `CECELIA_INTERNAL_TOKEN` 环境变量名。
- [生产源码] `packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES` 是九项角色白名单的权威来源。
- [生产源码] 派发失败回滚的终态是 `run→failed`、`session→closed`、`task→cancelled`。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`；本合同不回退到领域硬编码断言。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-usage.md` 新增中文使用说明，覆盖端点、鉴权、九角色、payload 和失败回滚。 |
| NFR（做得多好） | 单页、中文、可机械核对，不含真实凭据。 |
| Invariant（永不违反） | 仅新增目标文档；不修改代码、配置、测试或既有文档；不虚构 API 行为。 |
| 判定点（怎么知道） | 用冻结测试和 E2E 脚本对文档字面内容及候选 diff 做确定性断言。 |
| 保质期（何时过期） | 白名单或接口契约变化时由对应 API 变更同步更新此页。 |
| 死亡告警（停了谁知道） | 冻结测试/合同 E2E 在文档缺失或契约漂移时失败，由 CI 报告。 |
| 失败语义（挂了怎么办） | 任一内容或唯一变更边界不满足即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从候选提交读取目标文档并逐节断言，且核对 task_request_hash。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、角色数量错误或 hash 错误 | 验收命令非零退出并阻塞交付 | 是，修正文档后可重跑 | 无降级 |
| 候选 diff 触及范围外文件 | 验收命令非零退出并阻塞交付 | 是，移除越界改动后可重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[阅读说明] → [选择创建或查询端点] → [按位置鉴权并提交合法参数] → [理解成功结果或派发失败终态]

### Step 1: 读者识别创建与查询用途
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 文档分别说明 `POST /api/brain/harness/attempt-run` 用于异步创建并派发单角色 attempt，`GET /api/brain/harness/attempt-run/:id` 用于按 attempt id 查询状态与结构化结果。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','创建','查询'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 两个端点及两种用途全部出现；上述命令 exit 0。

### Step 2: 读者按调用位置完成鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 项。

**可观测行为**: 文档说明两端点均使用 `internalAuthOrLoopback`，loopback 可按中间件规则访问，宿主与远端必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不包含真实 token。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['internalAuthOrLoopback','宿主','远端','Bearer','CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 五项鉴权语义全部出现；上述命令 exit 0。

### Step 3: 读者获得合法角色与 payload 约束
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 文档列出且仅列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge` 九项角色；明确 payload 的 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');const b=s.match(/<!-- ROLE_LIST_START -->([\\s\\S]*?)<!-- ROLE_LIST_END -->/);if(!b)process.exit(1);const roles=[...b[1].matchAll(/^- \\x60([^\\x60]+)\\x60$/gm)].map(x=>x[1]);const want=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];if(JSON.stringify(roles)!==JSON.stringify(want))process.exit(1);for(const x of ['sprint_dir','base_repo','branch','base_sha','生产 Brain','可省略'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 角色列表机械计数恰为 9 且顺序/字面完全匹配权威白名单，payload 六项语义全部出现；上述命令 exit 0。

### Step 4: 读者理解派发失败自动回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档明确派发抛错或未进入 `LAUNCHED` 时，新建资源自动收敛到 `run→failed`、`session→closed`、`task→cancelled`，不承诺额外重试或补偿。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');for(const x of ['run→failed','session→closed','task→cancelled','LAUNCHED'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 三个回滚终态及触发语义全部出现；上述命令 exit 0。

### Step 5: 候选交付保持 docs-only 边界
**来源**: `[AI_ADDED]` — 把 PRD A6 的变更边界转成防止范围蔓延的机器断言。

**可观测行为**: 相对冻结实现基线 `88929fa377f5bed3cd1876a575c366ff1b93c0d5`，实现候选只新增 `docs/current/attempt-run-bridge-usage.md`；合同阶段自身的 sprint 冻结产物不计入实现候选范围。

**验证命令**: `bash -c 'test "$(git diff --name-only 88929fa377f5bed3cd1876a575c366ff1b93c0d5...HEAD -- docs/current packages apps scripts .github | sort)" = "docs/current/attempt-run-bridge-usage.md"'`

**硬阈值**: 实现候选的产品范围 diff 恰为一个目标文档；上述命令 exit 0。

## 真实调用方请求 shape

N/A — 本 sprint 只记录既有接口，不修改调用方或服务端请求 shape。文档示例必须保持生产字段名 `role`、`title` 与 `payload.sprint_dir/base_repo/branch/base_sha`。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

（本单不改变真实系统接缝；仅对已有生产源码契约作静态文档验收，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把未列入白名单的角色写成合法值。
- 重复提交: N/A，文档不执行提交。
- 中途中断: N/A，文档无运行过程。
- 边界值: 检查九角色计数、连字符角色和 `base_sha` 可省略语义。
发现分级: P0/P1（凭据泄露或错误鉴权指引）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-usage.md
BASE_SHA=88929fa377f5bed3cd1876a575c366ff1b93c0d5
HASH=fb7e86a156d48c9d342f74c8feee26cf570d7fed705eb39c86b41cd320c73050
test -f "$DOC"
node - "$DOC" "$HASH" <<'NODE'
const fs = require('fs');
const [doc, hash] = process.argv.slice(2);
const s = fs.readFileSync(doc, 'utf8');
if (!/[\u3400-\u9fff]/u.test(s)) throw new Error('文档必须包含中文');
for (const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Bearer','CECELIA_INTERNAL_TOKEN','宿主','远端','sprint_dir','base_repo','branch','base_sha','生产 Brain','可省略','run→failed','session→closed','task→cancelled',hash]) {
  if (!s.includes(x)) throw new Error(`缺少: ${x}`);
}
const block = s.match(/<!-- ROLE_LIST_START -->([\s\S]*?)<!-- ROLE_LIST_END -->/);
if (!block) throw new Error('缺少角色列表边界');
const got = [...block[1].matchAll(/^- `([^`]+)`$/gm)].map(m => m[1]);
const want = ['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];
if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`角色白名单错误: ${JSON.stringify(got)}`);
NODE
test "$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps scripts .github | sort)" = "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明完整性 | `sprints/coding-harness-20260831220855-sh8mp5/tests/attempt-run-bridge-usage.test.ts` | `包含两个端点用途与鉴权规则`、`角色白名单恰为生产九项`、`说明 payload 必填字段和 base_sha 自解析`、`说明派发失败的三个回滚终态`、`固定精确 task_request_hash` | 目标文档尚不存在，5 个用例读取文件时失败 |

## Notes

- contract-gate: 使用 Cecelia 仓库现有 `packages/brain/src/lib/contract-gate.js`，不适用第三方跳过规则。
- 本合同的实现基线始终为 `88929fa377f5bed3cd1876a575c366ff1b93c0d5`；角色 checkout SHA 不替换该基线。
