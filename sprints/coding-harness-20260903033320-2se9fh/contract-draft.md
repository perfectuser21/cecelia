# Sprint Contract Draft (Round 1)

task_request_hash: `aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f`

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [PRD Invariant] 凭据隔离：只写环境变量名 `CECELIA_INTERNAL_TOKEN`，不得写入真实 Token。
- [PRD Invariant] 实现与范围验收基线固定为 `6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb`；不得用角色 checkout SHA 替换。
- [packages/brain/src/routes/harness-attempt-run.js] `ALLOWED_ROLES` 是九项角色白名单的生产权威来源。
- [packages/brain/src/routes/harness-attempt-run.js] 派发未启动或抛错时，新建资源收敛到 run failed、session closed、task cancelled。
- [MAP_NOT_CONFIGURED] task payload 未提供 `map_scope` 与 `map_repo`，无 Unified Map `must_run_assertions`、`fact_revisions` 或 `freshness` 可加载。
- [累积FR] 本 line 暂无历史；`journey_id=none`，无可查询的 context-manifest。

contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| FR（做什么） | 对外承诺 | 新增一页中文说明，准确覆盖两个端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 质量阈值 | 四节齐全；九角色为恰好九项封闭集合；唯一实现变更位于 `docs/current/attempt-run-bridge.md`。 |
| Invariant（永不违反） | 安全与范围 | 不写真实 Token、不改代码、固定实现基线。 |
| 判定点（怎么知道） | 模糊状态判断 | N/A；全部是生产源码可逐字核对的封闭事实。 |
| 保质期（何时过期） | 退役条件 | 端点、鉴权、角色或 payload 合同变化时由对应代码变更同步修订。 |
| 死亡告警（停了谁知道） | 失效发现 | 冻结 Vitest 与范围 oracle 在 required CI 中失败。 |
| 失败语义（挂了怎么办） | 故障行为 | 任一内容或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 回执 | 测试解析最终文档并对正例与负例同时断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容漂移 | 测试非零退出并阻塞交付 | 是 | 无降级 |
| 范围出现额外文件 | 范围 oracle 非零退出并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或可写接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [确认端点与鉴权] → [确认九项角色] → [组装 payload] → [理解失败回滚]

### Step 1: 确认端点用途与鉴权

**来源**: `[FROM_PRD]` — thin PRD 第 1 项“两个端点的用途、鉴权方式”。

**可观测行为**: 文档明确 POST 用于发起运行、GET 用于按 id 查询状态；本机回环由 `internalAuthOrLoopback` 处理，宿主或远端必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**硬阈值与验证命令**: 两个端点、鉴权中间件和远端 Bearer 规则全部出现；错误变量名或“远端可免凭据”均不得出现。

```bash
npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t '端点与鉴权正负 oracle'
```

### Step 2: 确认九项角色白名单

**来源**: `[FROM_PRD]` — thin PRD 第 2 项“角色白名单九项”；角色字面值逐项取自生产 `ALLOWED_ROLES`。

**可观测行为**: 文档只列 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，无缺项、重复项或额外项。

**硬阈值与验证命令**: 解析“角色白名单”列表后去重集合与上述封闭集合字面相等且长度恰好为 9；增删任一项的负例必须被拒绝。

```bash
npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t '九项角色封闭集合正负 oracle'
```

### Step 3: 组装 payload

**来源**: `[FROM_PRD]` — thin PRD 第 3 项“payload 必填字段”。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，将 `base_sha` 标为可省略并说明由生产 Brain 自解析。

**硬阈值与验证命令**: 三个必填字段恰好命中必填标记；把 `base_sha` 标成必填或删掉生产 Brain 自解析说明的负例必须被拒绝。

```bash
npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t 'payload 字段正负 oracle'
```

### Step 4: 理解派发失败自动回滚

**来源**: `[FROM_PRD]` — thin PRD 第 4 项“run→failed/session→closed/task→cancelled”。

**可观测行为**: 文档同时说明新建 run、session、task 在派发失败时的三个终态。

**硬阈值与验证命令**: 三个状态箭头全部存在；任一终态被替换的负例必须被拒绝。

```bash
npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t '失败回滚正负 oracle'
```

### Step 5: 保持文档唯一实现范围

**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”转为不可用角色 checkout SHA 替换的确定性防越界 oracle。

**可观测行为**: 相对冻结实现基线，Sprint 的实现文件变化仅为 `docs/current/attempt-run-bridge.md`；合同自身位于 sprint 目录，不计作实现交付。

**硬阈值与验证命令**: canonical diff 输出过滤合同目录后必须恰好等于文档路径；额外实现路径的负例必须被集合比较拒绝。

```bash
ACTUAL=$(git diff --name-only 6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb...HEAD -- | grep -v '^sprints/coding-harness-20260903033320-2se9fh/' | sort); EXPECTED='docs/current/attempt-run-bridge.md'; [ "$ACTUAL" = "$EXPECTED" ]
```

## 真实调用方请求 shape

N/A — 本 Sprint 只记录既有接口，不修改调用 shape；文档示例固定使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，payload 关键字段为 `sprint_dir`、`base_repo`、`branch`，可选 `base_sha`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、模块接缝或 DB 写路径，N/A）

## 接缝清单

（本单只交付说明文档，无需连接真实服务或第三方，N/A）

gp-anchor: skipped (product-map.json not found)

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb
SPRINT_DIR=sprints/coding-harness-20260903033320-2se9fh
DOC=docs/current/attempt-run-bridge.md
test -f "$DOC"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-doc.test.ts"
ACTUAL=$(git diff --name-only "$BASE_SHA"...HEAD -- | grep -v "^$SPRINT_DIR/" | sort)
EXPECTED='docs/current/attempt-run-bridge.md'
[ "$ACTUAL" = "$EXPECTED" ] || { echo "FAIL: 实现范围越界: $ACTUAL"; exit 1; }
echo 'OK: attempt-run 桥接说明与唯一实现范围验收通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 把未知角色或缺失 `sprint_dir` 的请求与文档规则对照，确认不会被描述为可接受。
- 重复提交: 对照两次相同 run 请求，确认文档未承诺本 Sprint 范围外的幂等行为。
- 中途中断: 对照派发抛错与非 LAUNCHED 两条源码路径，确认三对象回滚描述均成立。
- 边界值: 增删一个角色、重复一个角色、把 `base_sha` 改为必填，确认冻结测试失败。
发现分级: P0/P1（凭据泄露、错误派发或错误回滚说明）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts` | 端点与鉴权正负 oracle；九项角色封闭集合正负 oracle；payload 字段正负 oracle；失败回滚正负 oracle；中文与冻结哈希 oracle | 文档尚不存在时测试因 `ENOENT` 失败 |

