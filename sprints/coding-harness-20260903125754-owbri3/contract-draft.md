# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面 + 生产路由）

本 Sprint 无 HTTP 实现改动，故不新增 Response Schema。文档只说明既有 `POST /api/brain/harness/attempt-run`（创建 attempt）与 `GET /api/brain/harness/attempt-run/:id`（查询 attempt）用途，不复制未被 PRD 要求的响应字段。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 路由挂载 POST `/attempt-run` 与 GET `/attempt-run/:attemptId`，生产白名单来自 `ALLOWED_ROLES`。
- `packages/brain/src/middleware/internal-auth.test.js` → `internalAuthOrLoopback` 区分 loopback 与远端认证。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`（task payload 的 `map_scope` 不是可用 scope/repo 字符串，`must_run_assertions` 为空）。
- implementation baseline: `b99c580d7fe8ca4cbf0ee834e13c91df02b57369`；该 SHA 是本合同唯一范围基线，不得用角色 checkout SHA 或 PRD 中的旧参考 SHA 替换。
- gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 新增一页中文说明，覆盖两个端点、鉴权、九角色、payload 和失败回滚。 |
| NFR（做得多好） | 质量阈值 | 四节可定位；枚举采用封闭集合；唯一产品差异是一页文档。 |
| Invariant（永不违反） | 安全与一致性 | 不写真实 Token，不修改代码、测试、配置或既有文档，不扩展 API。 |
| 判定点（怎么知道） | 模糊现实判断 | N/A：内容均可由冻结生产源码与精确集合机械核对。 |
| 保质期（何时过期） | 退役条件 | attempt-run 生产契约变化时，由对应代码变更同步修订文档。 |
| 死亡告警（停了谁知道） | 失效发现 | 冻结 Vitest 和范围 oracle 在交付验证中失败即告知 Generator/Evaluator。 |
| 失败语义（挂了怎么办） | 放行或拦截 | 任一正向或负向 oracle 失败即阻塞交付；不降级放行。 |
| 效果确认（已发≠已生效） | 真实回执 | 文档存在、内容集合精确匹配、git diff 精确匹配三类证据同时成立。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或章节缺失 | 测试非零退出并阻塞 | 是，补全文档后重跑 | 无 |
| 角色集合增删或重复 | 精确集合断言失败 | 是，按生产白名单修正后重跑 | 无“等”或近似集合 |
| 产品差异越界或为空 | canonical git diff equality 失败 | 是，恢复精确交付范围后重跑 | 无 |

### 输入对抗面

N/A：本 Sprint 不新增对外 agent 或可写接口，只交付静态说明文档。

## 真实调用方请求 shape

不新增调用方或请求行为。文档必须准确记录现有 shape：宿主/远端调用时使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`；创建请求的 `payload` 必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 自解析。不得把认证字段移入 body，也不得展示真实凭据。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；纯文档 Sprint 不执行真实派发。）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 接缝清单

无新增运行接缝。既有 attempt-run 真实派发行为仅作为文档事实来源，本 Sprint 不以执行派发冒充文档交付验证。

## Golden Path

独立小路（无父路）

[打开中文说明] → [区分创建与查询并确认鉴权] → [选择九项角色之一] → [组装 payload] → [理解失败回滚]

### Step 1: 打开说明并区分端点与鉴权

**来源**: `[FROM_PRD]` — thin PRD 第 1 项及 PRD「Golden Path」第 1、2 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 为中文，`## 端点与鉴权` 分别说明 POST 创建用途、GET 按 id 查询用途，并明确两端点采用 `internalAuthOrLoopback`；宿主/远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，不展示真实 Token。

**验证命令**:

```bash
npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t '端点与鉴权正负 oracle' --reporter=verbose
```

**硬阈值**: 两端点与鉴权四个字面事实全部命中；把 Bearer 名替换或声称远端免鉴权时测试必须失败。

### Step 2: 选择九项角色之一

**来源**: `[FROM_PRD]` — thin PRD 第 2 项与 PRD「Golden Path」第 3 项；名称逐字取自冻结基线生产 `ALLOWED_ROLES`。

**可观测行为**: 文档的 `## 角色白名单` 仅以九个独立列表项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**验证命令**:

```bash
npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t '九项角色封闭集合正负 oracle' --reporter=verbose
```

**硬阈值**: 长度恰为 9、去重长度恰为 9、排序后与生产 `ALLOWED_ROLES` 完全相等；增加 `commander` 或删除 `judge` 的负例必须失败。

### Step 3: 组装 payload

**来源**: `[FROM_PRD]` — thin PRD 第 3 项与 PRD「Golden Path」第 4 项。

**可观测行为**: `## payload 字段` 用独立列表逐项写 `sprint_dir`、`base_repo`、`branch` 为必填；另写 `base_sha` 可省略并由生产 Brain 自解析。

**验证命令**:

```bash
npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t 'payload 字段正负 oracle' --reporter=verbose
```

**硬阈值**: 必填集合精确等于三项；`base_sha` 不在必填集合且“可省略”和“生产 Brain 自解析”同时出现；把 `base_sha` 改为必填或把 `branch` 改为可省略时测试必须失败。

### Step 4: 理解派发失败自动回滚

**来源**: `[FROM_PRD]` — thin PRD 第 4 项与 PRD「Golden Path」第 5 项。

**可观测行为**: `## 派发失败自动回滚` 逐字给出 `run→failed/session→closed/task→cancelled`，解释派发异常或未进入 LAUNCHED 时新建桥接资源回滚。

**验证命令**:

```bash
npx vitest run --no-cache sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts -t '失败回滚正负 oracle' --reporter=verbose
```

**硬阈值**: 四对象和终态完整、次序固定；将 session 写为 open 或 task 写为 completed 的负例必须失败。

### Step 5: 保持唯一产品交付范围

**来源**: `[AI_ADDED]` — 把 PRD“不改任何代码”和 task contract 的 canonical scope oracle 转为防空集合、防越界的机械 equality。

**可观测行为**: 相对权威实现基线 `b99c580d7fe8ca4cbf0ee834e13c91df02b57369`，排除本 Sprint 的合同产物后，变更集合必须且只能是新增 `docs/current/attempt-run-bridge-guide.md`。

**验证命令**:

```bash
BASE_SHA='b99c580d7fe8ca4cbf0ee834e13c91df02b57369'
SPRINT_DIR='sprints/coding-harness-20260903125754-owbri3'
EXPECTED='docs/current/attempt-run-bridge-guide.md'
ACTUAL=$(git diff --name-only "${BASE_SHA}...HEAD" -- | grep -v "^${SPRINT_DIR}/" | sort)
[ "$ACTUAL" = "$EXPECTED" ]
```

**硬阈值**: `ACTUAL` 与 `EXPECTED` 逐字相等；空集合、多一项代码/配置/测试、修改其他既有文档都必须失败。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 将 `base_sha` 错列为必填，确认 payload 负向 oracle 阻塞。
- 重复提交: 在角色清单重复一个合法角色，确认数量和唯一性 oracle 阻塞。
- 中途中断: N/A，纯静态文档无运行中状态。
- 边界值: 增删一个角色、删除一个端点、写入未知第五节，确认封闭集合或范围契约不会假绿。
发现分级: P0/P1（凭据泄露、错误鉴权或错误生产契约）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE_SHA='b99c580d7fe8ca4cbf0ee834e13c91df02b57369'
SPRINT_DIR='sprints/coding-harness-20260903125754-owbri3'
EXPECTED='docs/current/attempt-run-bridge-guide.md'
git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null
npx vitest run --no-cache "${SPRINT_DIR}/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
ACTUAL=$(git diff --name-only "${BASE_SHA}...HEAD" -- | grep -v "^${SPRINT_DIR}/" | sort)
[ "$ACTUAL" = "$EXPECTED" ] || { echo "FAIL: 产品差异集合=$ACTUAL"; exit 1; }
ADDED=$(git diff --name-only --diff-filter=A "${BASE_SHA}...HEAD" -- | grep -v "^${SPRINT_DIR}/" | sort)
[ "$ADDED" = "$EXPECTED" ] || { echo "FAIL: 唯一文档不是新增文件，新增集合=$ADDED"; exit 1; }
if git diff "${BASE_SHA}...HEAD" -- "$EXPECTED" | grep -E '^\+Authorization: Bearer [A-Za-z0-9_./+=-]{24,}$'; then echo 'FAIL: 疑似真实 token'; exit 1; fi
echo 'OK: attempt-run 桥接说明及精确范围通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | 端点与鉴权正负 oracle | 文档不存在时 `ENOENT`；错误 Bearer 或远端免鉴权突变返回 false |
| 九角色封闭集合 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | 九项角色封闭集合正负 oracle | 缺项、多项、重复项或与生产集合不等时失败 |
| payload 契约 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | payload 字段正负 oracle | 把 `base_sha` 设为必填或漏必填字段时失败 |
| 失败回滚 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | 失败回滚正负 oracle | 任一终态被成功/活跃态替换时失败 |
| 中文结构 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | 中文文档与四节正负 oracle | 文档或任一固定章节缺失时失败 |
| 唯一交付范围 | `sprints/coding-harness-20260903125754-owbri3/tests/attempt-run-bridge-guide.test.ts` | 实现 diff 仅有一页文档正负 oracle | 当前无产品文档导致空集合失败；任何越界文件导致集合不等 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` present)
- PRD 内旧参考 SHA `7984b6cfb5fd43294ece90d20257434dc917903c` 不作为范围基线；权威 `inputs.implementation_baseline.base_sha` 固定为 `b99c580d7fe8ca4cbf0ee834e13c91df02b57369`。
- 不要求或固化未来 Generator/Evaluator/Judge 的 attempt、account 或 capability snapshot；验证身份由 Runner 在实际角色执行时 late-bound。
