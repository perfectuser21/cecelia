# Sprint Contract Draft (Round 1)

task_request_hash: `64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709`

## Response Schema（推导来源: N/A）

N/A — 本任务仅新增说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单长度为 9，包含生产执行角色且排除 commander/publisher。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`，没有可注入的 `must_run_assertions`、`fact_revisions` 或 `freshness`。
- task_request_hash: `64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709`

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 名称逐字准确；角色为恰好九项封闭集合；不泄露令牌；唯一产品工件。 |
| Invariant（永不违反） | 不改代码；不写真实密钥；不把 loopback 免 Bearer 扩展到宿主或远端。 |
| 判定点（怎么知道） | 以生产路由定义和冻结测试的精确文本、封闭集合与负向断言判定。 |
| 保质期（何时过期） | 角色、字段、鉴权或回滚语义变化时由对应 API 变更者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 在文档缺失或漂移时立即失败并阻塞合入。 |
| 失败语义（挂了怎么办） | 任一章节、成员或负向安全约束失败即拦截，不降级放行。 |
| 效果确认（已发≠已生效） | 读取最终文档并逐节断言；git diff 精确确认唯一产品工件。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容漂移 | 测试非零退出并阻塞合入 | 是 | 无降级 |
| 范围出现额外产品文件 | 范围 oracle 非零退出并阻塞合入 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [准备鉴权与 payload] → [POST 派发] → [GET 查询] → [识别失败回滚]

### Step 1: 找到中文桥接说明并理解两个端点
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 分别说明 POST 创建/派发和 GET 按 id 查询。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t '文档写明两个端点用途'`

**硬阈值**: 两个端点均出现且 GET 不得被描述为创建/派发入口；命令 exit 0。

### Step 2: 按访问位置准备鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项与「边界情况」。

**可观测行为**: 文档说明 `internalAuthOrLoopback`，并明确宿主/远端携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t '鉴权正向说明'`

**硬阈值**: 正向鉴权说明齐全，且无真实 token、无远端免鉴权表述；命令 exit 0。

### Step 3: 选择允许的执行角色
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项。

**可观测行为**: 文档按生产顺序逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t '角色白名单是逐项列名'`

**硬阈值**: 集合恰好九项、顺序和名称逐字一致，不含“等”、commander 或 publisher；命令 exit 0。

### Step 4: 准备 payload 并理解 base_sha 解析
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 文档标明 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t 'payload 正向列出'`

**硬阈值**: 三个必填字段齐全，base_sha 不得写成必填或由调用方猜测；命令 exit 0。

### Step 5: 识别派发失败后的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 文档明确 `run → failed`、`session → closed`、`task → cancelled`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts -t '派发失败正向列出'`

**硬阈值**: 三实体目标状态全部出现，且不出现相反终态；命令 exit 0。

### Step 6: 锁定唯一产品交付范围
**来源**: `[AI_ADDED]` — 将 PRD 的唯一文件范围变成不可被额外代码或文档改动绕过的机器 oracle。

**可观测行为**: 相对冻结实现基线，除 sprint 合同工件外唯一产品变更是目标文档。

**验证命令**: 执行下方 E2E 验收中的 canonical git diff 范围段。

**硬阈值**: 产品变更集合精确等于 `docs/current/attempt-run-bridge-guide.md`；命令 exit 0。

## 真实调用方请求 shape

N/A — 本 Sprint 只编写既有端点说明，不发请求、不改变真实调用方 shape。

## 禁 mock 边清单

（本单纯文档改动，无接缝边，N/A）

## 接缝清单

（本单无真机、异步、第三方或 DB 接缝，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

gp-anchor: skipped (product-map.json not found)

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
TASK_REQUEST_HASH='64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709'
SPRINT_DIR='sprints/coding-harness-20260903063439-nm83sq'
DOC='docs/current/attempt-run-bridge-guide.md'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
grep -Fq "$TASK_REQUEST_HASH" "$SPRINT_DIR/contract-draft.md"
grep -Fq "$TASK_REQUEST_HASH" "$SPRINT_DIR/contract-dod.md"
grep -Fq "$TASK_REQUEST_HASH" "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"

BASE_SHA="863590823193364151bd4aae610f68aaaa42e200"
git diff --name-only "$BASE_SHA"...HEAD | grep -q '^docs/current/attempt-run-bridge-guide.md$'
test "$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^$SPRINT_DIR/" | wc -l | tr -d ' ')" = 1
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 GET 写成派发入口。
- 重复提交: 检查九角色是否重复列名后仍伪装成九行。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查“等”省略词、真实令牌形态与额外产品文件。
发现分级: P0/P1（泄密、错误鉴权或错误派发说明）阻塞 merge；P2/P3 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260903063439-nm83sq/tests/attempt-run-bridge-guide.test.ts` | `文档写明两个端点用途`；`鉴权正向说明`；`角色白名单是逐项列名`；`payload 正向列出`；`派发失败正向列出` | 目标文档尚不存在，5 个测试因 ENOENT 失败 |

## Notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `863590823193364151bd4aae610f68aaaa42e200`（冻结，未被 workspace checkout SHA 替换）
- task_request_hash: `64de302ba99ea7e35a528afdc12dbeaa8eede8d1076c32f7fef385b0504b9709`
