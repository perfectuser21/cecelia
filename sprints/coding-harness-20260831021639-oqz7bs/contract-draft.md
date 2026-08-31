# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭，包含九个执行角色，且路由同时暴露 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 在生产/远端调用上的鉴权行为已有回归测试。
- [MAP_NOT_CONFIGURED] task 未提供 map_scope/map_repo，未回退到领域硬编码。
- context-manifest: unavailable（bundle 未提供 journey_id，无法构造 T3 请求）。
- 铁律清单: bundle 未注入额外铁律；仓库 AGENTS.md 规则继续适用。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增中文说明，准确覆盖两个端点、鉴权、九角色、payload 与派发失败回滚。 |
| NFR（做得多好） | 内容可由单个 Vitest 与 shell E2E 确定性检查；不改代码。 |
| Invariant（永不违反） | 文档不得泄露 token；不得把 `base_sha` 写成必填；不得扩展角色白名单。 |
| 判定点（怎么知道） | 以生产路由与鉴权中间件的字面契约为准。 |
| 保质期（何时过期） | 端点、白名单、payload 或回滚实现变化时由相应代码 PR 同步更新。 |
| 死亡告警（停了谁知道） | 文档测试在 Sprint Tests 中失败并阻塞合入。 |
| 失败语义（挂了怎么办） | 缺节、错角色或错回滚状态均失败，不降级放行。 |
| 效果确认（已发≠已生效） | 读取最终文档并逐项匹配生产代码中的公开契约。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺少任一必需主题 | 测试非零退出并阻塞合入 | 是 | 无 |
| 文档把 `base_sha` 误写为必填 | 测试非零退出并阻塞合入 | 是 | 无 |

### 输入对抗面

N/A — 不新增对外 Agent 或可写接口。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本任务记录既有接口，不新增或修改调用方 shape。文档示例仍须使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，payload 字段逐字采用生产路由契约。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## Golden Path

独立小路（无父路）

[维护者打开说明] → [识别接口与鉴权] → [按白名单和 payload 派发] → [理解失败回滚与查询结果]

### Step 1: 读者定位两个桥接端点及用途
**来源**: `[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**: 文档分别说明 POST 用于异步派发单角色 attempt，GET 用于按 attempt id 轮询结构化结果。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','异步派发','轮询']) if(!s.includes(x)) process.exit(1)"`

**硬阈值**: 两个完整路径与两个用途词全部出现；上述命令 exit 0。

### Step 2: 读者正确配置鉴权
**来源**: `[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**: 文档说明中间件为 `internalAuthOrLoopback`，宿主及远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不展示真实密钥。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); for(const x of ['internalAuthOrLoopback','Authorization: Bearer $CECELIA_INTERNAL_TOKEN','宿主','远端']) if(!s.includes(x)) process.exit(1)"`

**硬阈值**: 四项鉴权信息全部出现；上述命令 exit 0。

### Step 3: 读者按九角色白名单和 payload 契约发起请求
**来源**: `[FROM_PRD]` — thin PRD 第 2、3 项。

**可观测行为**: 文档逐字列出九个角色；明确 `payload.sprint_dir`、`payload.base_repo`、`payload.branch` 必填，而 `payload.base_sha` 可省略并由生产 Brain 解析。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge']; for(const x of [...roles,'sprint_dir','base_repo','branch','base_sha','可省略','生产 Brain']) if(!s.includes(x)) process.exit(1)"`

**硬阈值**: 九角色及字段语义全部命中；上述命令 exit 0。

### Step 4: 读者理解派发失败的自动回滚
**来源**: `[FROM_PRD]` — thin PRD 第 4 项。

**可观测行为**: 文档明确派发抛错或未返回 LAUNCHED 时，当前调用新建的 run 变 failed、session 变 closed、task 变 cancelled。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8'); for(const x of ['run → failed','session → closed','task → cancelled','LAUNCHED']) if(!s.includes(x)) process.exit(1)"`

**硬阈值**: 三组资源状态和触发条件全部出现；上述命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `title` 或 `role` 混入 payload 必填字段。
- 重复提交: 检查 POST 示例是否暗示重复请求必然复用 run。
- 中途中断: 检查派发未 LAUNCHED 与派发抛错两种描述是否都落到相同回滚结果。
- 边界值: 检查九角色是否恰好九项，且连字符角色未被拆写。
发现分级: P0/P1（泄露密钥或指导错误生产调用）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
TEST=sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts
test -s "$DOC"
npx vitest run --no-cache "$TEST" --reporter=verbose
git diff --name-only 1ef19bd6f70b79e14a20ecb0e37ba8492f71a029...HEAD | awk '$0 ~ /^packages\/brain\/src\// { bad=1 } END { exit bad }'
echo "attempt-run 桥接说明验收通过"
```

通过标准：脚本 exit 0；文档非空；冻结测试全绿；实现相对权威基线不含 `packages/brain/src/` 改动。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts` | `覆盖两个端点的用途与鉴权方式`、`完整列出九项角色白名单`、`说明 payload 必填字段与 base_sha 省略语义`、`说明派发失败自动回滚的三个终态` | 实现文档尚不存在，4 个用例因 ENOENT 失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `1ef19bd6f70b79e14a20ecb0e37ba8492f71a029`（固定用于实现差异验收；不以角色 checkout 替换）。
