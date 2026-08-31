# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A — 仅新增使用说明文档）

N/A — 本 sprint 不新增或修改 HTTP 端点、响应字段、数据库或运行逻辑；仅如实说明现有 attempt-run 桥接接口。

## 已知约束（来自回归测试 + 累积 FR）

- [`packages/brain/src/routes/harness-attempt-run.js`] → `ALLOWED_ROLES` 固定为九项；POST 异步派发并返回 202，GET 按 attempt id 返回结构化结果。
- [`packages/brain/src/middleware/internal-auth.js`] → `internalAuthOrLoopback` 允许本机回环；宿主或远端调用使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → POST 与 GET 路由、白名单及派发资源回滚已有代码级回归约束，本 sprint 不修改这些实现或测试。
- [累积FR] context-manifest: unavailable；thin PRD 已提供完整文档范围。
- [MAP_NOT_CONFIGURED] task bundle 未提供 map_scope/map_repo；无 must_run_assertions，不回退到领域硬编码。

## 锚定父路声明

独立小路（无父路）——为既有 V4 attempt-run 桥接接口补齐运维使用说明，不改变业务 Golden Path。

## Golden Path

[读者打开中文说明] → [识别 POST/GET 用途与鉴权] → [按九项白名单选择角色并填写 payload] → [理解派发失败时三类资源自动回滚]

### Step 1: 找到 attempt-run 桥接说明与两端点用途
**来源**: `[FROM_PRD]` — thin PRD「在 docs/current/ 下新增一页《attempt-run 桥接使用说明》」及第 1 项。

**可观测行为**: `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md` 为中文文档，分别说明 `POST /api/brain/harness/attempt-run` 用于异步派发单角色 attempt、`GET /api/brain/harness/attempt-run/:id` 用于轮询状态和读取结构化结果。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md';const s=fs.readFileSync(p,'utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','异步派发','轮询'])if(!s.includes(x))process.exit(1)"
```
**硬阈值**: 文档存在，两个完整端点及用途关键词全部命中；命令退出码 0。

### Step 2: 读者按调用位置选择正确鉴权方式
**来源**: `[FROM_PRD]` — thin PRD 第 1 项明确 `internalAuthOrLoopback`，宿主/远端必须带 Bearer `CECELIA_INTERNAL_TOKEN`。

**可观测行为**: 文档明确回环请求可由 `internalAuthOrLoopback` 放行；宿主或远端请求必须带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，不得将 token 字面值写入文档。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md','utf8');for(const x of ['internalAuthOrLoopback','宿主','远端','Authorization: Bearer','CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))process.exit(1)"
```
**硬阈值**: 五个鉴权关键项全部命中，且仓库未新增凭据；命令退出码 0。

### Step 3: 按九项角色白名单和 payload 契约构造请求
**来源**: `[FROM_PRD]` — thin PRD 第 2、3 项明确九项白名单和 payload 必填字段。

**可观测行为**: 文档逐字列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`；说明 `payload.sprint_dir`、`payload.base_repo`、`payload.branch` 必填，`payload.base_sha` 可省略并由生产 Brain 自解析。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md','utf8');const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];const fields=['payload.sprint_dir','payload.base_repo','payload.branch','payload.base_sha'];for(const x of [...roles,...fields,'可省略','生产 Brain'])if(!s.includes(x))process.exit(1)"
```
**硬阈值**: 九个角色和四个字段逐字命中，并明确三个必填、一个可省略；命令退出码 0。

### Step 4: 理解派发失败的自动回滚终态
**来源**: `[FROM_PRD]` — thin PRD 第 4 项明确 `run→failed/session→closed/task→cancelled`。

**可观测行为**: 文档单独说明派发抛错或未得到 `LAUNCHED` 时，对本调用新建资源自动回滚：run 进入 `failed`、controller session 进入 `closed`、锚 task 进入 `cancelled`。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md','utf8');for(const x of ['派发失败自动回滚','run','failed','session','closed','task','cancelled'])if(!s.includes(x))process.exit(1)"
```
**硬阈值**: 回滚标题和三组资源/终态全部命中；命令退出码 0。

### Step 5: 限定实现变更只落在 docs/current
**来源**: `[AI_ADDED]` — 防止文档任务越权改动代码；thin PRD 已明确「不改任何代码」。

**可观测行为**: 实现提交相对冻结基线 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291` 的变更文件仅位于 `docs/current/`。

**验证命令**:
```bash
bash -c 'BAD=$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD | grep -v "^docs/current/" | grep -v "^sprints/coding-harness-20260831083208-k8r6yo/" || true); [ -z "$BAD" ] || { echo "$BAD"; exit 1; }'
```
**硬阈值**: 实现候选 diff 中 docs/current/ 外文件数为 0；退出码 0。合同产物由 GAN 分支独立封印，不计入实现候选 diff。

## 真实调用方请求 shape

N/A — 本 sprint 不实现调用方或服务端，仅记录既有请求契约；不新增认证分支、header 或 payload 字段。

## 禁 mock 边清单

（本单为纯文档改动，无调度、状态机、跨模块传递、生命周期钩子或 DB 写路径变更，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免；不执行真实派发，因为 PRD 只要求静态使用说明且禁止改代码，N/A。）

## 接缝清单

（本单不改变真实系统接缝；文档内容由冻结测试与现有路由源码逐项对照，N/A。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| **FR（做什么）** | 功能需求 | 在 `docs/current/` 新增中文 attempt-run 桥接使用说明，覆盖端点、鉴权、九角色、payload 与失败回滚 |
| **NFR（做得多好）** | 可维护性 | 单页中文说明；关键字可机器核验；不改任何代码 |
| **Invariant（永不违反）** | 范围不变量 | 实现 diff 只能位于 `docs/current/`；角色和字段必须与现有路由字面一致 |
| **判定点（怎么知道）** | 验收判断 | 见下表；全部为确定性文本契约，无外部状态推断 |
| **保质期（何时过期）** | 文档有效期 | 路由、白名单、鉴权或回滚语义变化时由相应代码变更同步更新本文档 |
| **死亡告警（停了谁知道）** | 漂移发现 | 冻结 Vitest 在 Sprint Tests 中检查四节与关键字；缺失即 CI 失败 |
| **失败语义（挂了怎么办）** | 验收失败 | 缺任何必需章节、字段或角色即 fail-closed，禁止合并 |
| **效果确认（已发≠已生效）** | 真实效果 | 对新增文件执行 Vitest，并以 git diff 验证仅 docs/current/ 有实现变更 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺少任一必需主题或字面字段 | 冻结测试非 0，阻塞合并 | 是 | 补齐文档后重跑 |
| 实现候选改动 docs/current/ 外文件 | 范围断言非 0，阻塞合并 | 是 | 移除越界实现变更 |

### 输入对抗面

N/A — 不新增对外 agent 或用户输入接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 对照源码确认文档未把 `:id` 错写为 run id；应明确它是 attempt id
- 重复提交: 搜索角色名，确认相似子串未导致漏项或重复项
- 中途中断: 从文档任意小节开始阅读，仍可定位鉴权与 payload 要求
- 边界值: 核对 `base_sha` 仅为可省略字段，未误写为必填
发现分级: P0/P1（鉴权、字段或回滚语义错误）→ 阻塞 merge；P2/P3（排版问题）→ 记 findings 不阻塞

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
set -euo pipefail
cd /workspace
npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts --no-cache --reporter=dot
BAD=$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD | grep -v '^docs/current/' | grep -v '^sprints/coding-harness-20260831083208-k8r6yo/' || true)
[ -z "$BAD" ] || { echo "FAIL: 实现候选越界改动"; echo "$BAD"; exit 1; }
echo "OK: attempt-run 桥接使用说明完整且实现范围合规"
```

**通过标准**: 冻结测试 5 条全绿；实现候选相对权威 baseline 的变更文件全部位于 `docs/current/`；脚本退出码 0。

gp-anchor: skipped (product-map.json not found)

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接使用说明 | `sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts` | `说明 POST 与 GET 两个端点用途`、`说明 internalAuthOrLoopback 与远端 Bearer 鉴权`、`完整列出九项角色白名单`、`说明 payload 必填字段与 base_sha 省略语义`、`说明派发失败自动回滚三类终态` | 文档尚不存在，5 个用例全部失败 |

> 覆盖名均为冻结测试 `it()` 名的字面子串；冻结测试位于本 sprint 的 `tests/`，必须随合同 commit。
