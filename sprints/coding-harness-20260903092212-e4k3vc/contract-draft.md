# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与累积 FR）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭，恰含九个执行角色且不含 `commander`、`publisher`。
- `packages/brain/src/middleware/internal-auth.test.js` → loopback 与远端请求遵循 `internalAuthOrLoopback`。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 未提供可用的 map_scope/map_repo，must_run_assertions 为空）。
- implementation baseline: `1537048ba85b8ff2e713167d941de02b89673a02`，不得替换为角色 checkout SHA 或 PRD 注释中的旧 SHA。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容可独立阅读；枚举使用封闭集合；不泄露 token；只新增一页文档。 |
| Invariant（永不违反） | 不修改代码、既有测试、配置和既有文档；不把 `base_sha` 写成必填；不扩展生产契约。 |
| 判定点（怎么知道） | 以生产 `ALLOWED_ROLES` 和路由源码为权威，并以封闭集合断言。 |
| 保质期（何时过期） | attempt-run 生产契约变化时由该契约维护者同步更新文档。 |
| 死亡告警（停了谁知道） | N/A：文档任务不新增运行中服务；既有端点告警不在本 sprint 范围。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 从冻结 baseline 对候选 HEAD 做只读内容与封闭 diff 检查。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项、枚举不闭合或范围越界 | 验收命令非零退出并阻塞交付 | 是，只读检查可重复 | 无降级 |

### 输入对抗面

N/A：本任务不新增对外 agent 或输入入口。

## Golden Path

独立小路（无父路）

[阅读说明] → [识别端点与鉴权] → [构造合法 payload/role] → [理解查询与失败回滚]

### Step 1: 找到桥接入口与鉴权规则
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 读者能区分 POST 创建与 GET 查询用途，并知道 loopback 规则及宿主/远端 Bearer 要求。

**验证命令**: `node -e` 读取目标文档，逐字断言两个端点、`internalAuthOrLoopback`、`Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，并反向拒绝“远端免鉴权”。

**硬阈值**: 两个端点、鉴权中间件与远端 Bearer 要求全部出现；误导性免鉴权表述为 0。

### Step 2: 选择生产允许的角色
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项及「假设」中的权威白名单要求。

**可观测行为**: 文档以封闭枚举列出且只列出九项：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**验证命令**: 冻结测试从生产模块读取 `ALLOWED_ROLES`，解析文档角色代码项并断言排序后的集合全等；另断言 `commander`、`publisher` 不出现在角色清单。

**硬阈值**: 数量恰为 9、集合完全相等，额外角色数量为 0。

### Step 3: 构造 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，将 `base_sha` 标为可省略且由生产 Brain 自解析。

**验证命令**: 解析 payload 章节的必填与可选代码项，正向断言三个必填项，负向断言 `base_sha` 不属于必填集合并属于可省略说明。

**硬阈值**: 必填集合严格等于三个字段；`base_sha` 仅为可省略字段。

### Step 4: 查询并判断派发失败回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档说明 GET 用于按 attempt id 轮询结构化结果，并逐字给出 `run→failed/session→closed/task→cancelled`。

**验证命令**: 读取目标文档并断言查询用途及完整回滚串，负向断言不存在把任一终态写成成功/活跃态的替代串。

**硬阈值**: 三个资源终态顺序和值逐字一致，缺一即失败。

## 真实调用方请求 shape

本文是既有接口说明：宿主/远端使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；POST JSON 顶层包含 `role`，其 `payload` 对象包含 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略；GET 路径参数为 `:id`。合同不调用生产端点、不打印 token。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 接缝清单

（本任务仅以仓库生产源码作为文档事实源，无运行环境接缝，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把 `base_sha` 错列为必填。
- 重复提交: 检查角色名在白名单章节重复出现时是否被解析为非九项集合。
- 中途中断: N/A，纯静态文档无中断状态。
- 边界值: 检查角色集合缺一项或多一项时封闭集合 oracle 必须失败。
发现分级: P0/P1（安全误导或生产契约错误）阻塞 merge；P2/P3 记录 findings。

gp-anchor: skipped (product-map.json not found)

## Notes

- contract-gate: 使用 Cecelia 仓库现有 `packages/brain/src/lib/contract-gate.js`。
- 本任务的“中文”以文档至少包含一个汉字且四个业务章节均为中文说明为 oracle。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（task payload 固定；本次仅执行仓库只读断言，不启动 UI）

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE_SHA='1537048ba85b8ff2e713167d941de02b89673a02'
SPRINT_DIR='sprints/coding-harness-20260903092212-e4k3vc'
DOC='docs/current/attempt-run-bridge-guide.md'
git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null
npx vitest run --no-cache "${SPRINT_DIR}/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
CHANGED=$(git diff --name-only --diff-filter=ACMRTUXB "${BASE_SHA}...HEAD" -- . | awk -v prefix="${SPRINT_DIR}/" 'index($0,prefix)!=1')
[ "$CHANGED" = "$DOC" ] || { echo "FAIL: 实现范围必须且只能新增 $DOC，实际: $CHANGED"; exit 1; }
ADDED=$(git diff --name-only --diff-filter=A "${BASE_SHA}...HEAD" -- . | awk -v prefix="${SPRINT_DIR}/" 'index($0,prefix)!=1')
[ "$ADDED" = "$DOC" ] || { echo "FAIL: $DOC 必须是唯一实现新增文件，实际: $ADDED"; exit 1; }
echo 'OK: attempt-run 桥接文档与范围验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260903092212-e4k3vc/tests/attempt-run-bridge-guide.test.ts` | 文档覆盖两个端点及鉴权；角色白名单是恰好九项的封闭集合；payload 必填集合严格等于三项；派发失败回滚终态完整；实现 diff 仅有一页文档 | 目标文档尚不存在，Vitest 至少 1 项失败 |
