# Sprint Contract Draft (Round 1)

## Notes

- implementation baseline: `393815bcbc288a4f9c357f3812024b52659a2dee`（固定，不使用角色 checkout SHA 替换）
- `[MAP_NOT_CONFIGURED]`：task payload 的 `map_scope` 为空数组，未配置 Unified Map scope/repo；无 `must_run_assertions`。
- registry：仅用于确认仓库既有命名；本 Sprint 不新增或修改 API/DB schema。
- context-manifest: unavailable（`journey_id=none`，无可读取的累积 FR）。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 只新增使用说明，不新增或修改 HTTP 响应。文档必须逐字引用现有端点名与字段名，不重新定义响应 schema。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭，包含九个执行角色且不含 commander/publisher。
- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → POST/GET 路由、鉴权和 attempt-run 投影由现有生产实现约束。
- `[累积FR]` 本 line 暂无历史。
- `[INV-1 端点鉴权]` 本 Sprint 不改端点；说明必须明确 `internalAuthOrLoopback`，且宿主/远端必须发送 Bearer token。
- `[INV-2 Planner 分支]` N/A：只新增说明文档，不修改 Planner workspace 或分支逻辑。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点用途、鉴权、九项角色、payload 和派发失败回滚。 |
| NFR（做得多好） | 四个主题完整、角色集合精确、字段必填性无歧义；唯一产品产物为目标文档。 |
| Invariant（永不违反） | 不改代码/API/鉴权/白名单/配置；远端不得被描述为匿名可访问。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 对文档章节和精确集合做机器断言。 |
| 保质期（何时过期） | 生产端点、鉴权、角色或 payload 契约变化时由对应代码变更负责人同步修订。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 在文档缺项或漂移时阻塞 CI，PR 作者当次获知。 |
| 失败语义（挂了怎么办） | 任一缺项、额外角色或越界产品文件均返回非零并阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 直接读取候选提交中的文档，并逐节断言内容及基线差异。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不全 | 测试 exit 非 0，阻塞交付 | 是，补正文后重跑 | 无降级 |
| 产品差异出现目标文档外文件 | E2E exit 非 0，阻塞交付 | 是，移除越界差异后重跑 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入接口。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、模块接缝或 DB 写路径，N/A）

## 真实调用方请求 shape

N/A — 本 Sprint 不新增或修改调用请求；说明只记录现有调用方式，不以合同测试发起业务请求。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [构造并鉴权 POST] → [按 id 查询 GET] → [解释成功或回滚终态]

### Step 1: 找到中文说明并识别两个端点用途
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge.md` 是中文说明，分别解释 POST 创建并派发、GET 按 id 查询。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t '中文说明分别解释 POST 创建派发与 GET 按 id 查询'
```

**硬阈值**: 文档存在；中文字符至少 20 个；两个完整端点和两种用途全部命中。以上 Vitest 命令 exit 0 为通过。

### Step 2: 按调用位置选择正确鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项。

**可观测行为**: 读者能区分 loopback 与宿主/远端；宿主/远端必须带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t '鉴权章节区分 loopback 与宿主远端 Bearer 要求'
```

**硬阈值**: `internalAuthOrLoopback`、loopback、宿主/远端、Authorization、Bearer、CECELIA_INTERNAL_TOKEN 同时出现；命令 exit 0。

### Step 3: 选择合法角色并填写 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3、4 项。

**可观测行为**: 角色章节精确列出九项生产白名单；payload 章节明确三个必填字段与 `base_sha` 的省略语义。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t '角色章节精确列出九项生产白名单|payload 章节锁定三个必填字段与 base_sha 省略语义'
```

**硬阈值**: 角色集合恰为 `canary,planner,proposer,reviewer,generator,generator-fix,evaluator,evaluator-evidence-repair,judge`；三个必填字段与一个可省略字段全部匹配；命令 exit 0。

### Step 4: 查询并解释派发失败回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 文档明确 GET 可观察失败结果，并同时说明 run、session、task 三类对象的终态。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts -t '失败回滚章节同时说明三类对象终态与查询观察方式'
```

**硬阈值**: `run → failed`、`session → closed`、`task → cancelled` 三项无缺失，且关联 GET 查询；命令 exit 0。

### Step 5: 保持仅文档实现边界
**来源**: `[AI_ADDED]` — 将 PRD「范围限定」转成候选提交可机检的防越界门禁。

**可观测行为**: 相对固定 implementation baseline，除 Sprint 冻结合同产物外，产品差异只有目标说明文档。

**验证命令**:
```bash
bash -c 'BASE=393815bcbc288a4f9c357f3812024b52659a2dee; BAD=$(git diff --name-only "$BASE"...HEAD | grep -v "^sprints/coding-harness-20260901125536-w93uqq/" | grep -v "^docs/current/attempt-run-bridge.md$" || :); [ -z "$BAD" ] || { echo "$BAD"; exit 1; }'
```

**硬阈值**: 越界产品文件数为 0；命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查白名单外角色没有被误写为合法角色。
- 重复提交: 检查同一字段在不同章节的必填性没有矛盾。
- 中途中断: N/A（静态文档无中断状态）。
- 边界值: 检查 `base_sha` 可省略没有被扩张为其他三个字段也可省略。
发现分级: P0/P1（错误鉴权或错误回滚语义）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅使用该 checkout 的 shell/Node；不启动浏览器，因为 PRD 不含 UI 行为）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=393815bcbc288a4f9c357f3812024b52659a2dee
SPRINT_DIR=sprints/coding-harness-20260901125536-w93uqq
DOC=docs/current/attempt-run-bridge.md

npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-doc.test.ts"

BAD=$(git diff --name-only "$BASE_SHA"...HEAD \
  | grep -v "^${SPRINT_DIR}/" \
  | grep -v "^${DOC}$" || :)
[ -z "$BAD" ] || { echo "FAIL: 越界产品差异"; echo "$BAD"; exit 1; }
test -f "$DOC"
echo "OK: attempt-run 桥接中文说明及仅文档边界通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260901125536-w93uqq/tests/attempt-run-bridge-doc.test.ts` | 中文说明分别解释 POST 创建派发与 GET 按 id 查询；鉴权章节区分 loopback 与宿主远端 Bearer 要求；角色章节精确列出九项生产白名单；payload 章节锁定三个必填字段与 base_sha 省略语义；失败回滚章节同时说明三类对象终态与查询观察方式 | 目标文档尚未实现，读取文件产生 ENOENT，至少 5 tests failed |

