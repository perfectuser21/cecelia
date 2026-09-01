# Sprint Contract Draft (Round 1)

## Notes

- 实现基线固定为 `6496b3ba2e74f278f60fedb621127cde6c618108`，不得用角色 checkout SHA 替换。
- `[MAP_NOT_CONFIGURED]`：任务未配置 `map_scope/map_repo`，无 `must_run_assertions`。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本任务仅新增文档，无 HTTP 响应或 DB 迁移。

## 已知约束

- `[PRD Invariant]` 文档不得包含真实 token；宿主/远端调用必须描述 Bearer 鉴权。
- `[PRD Invariant]` 派发失败必须描述三个终态，不能保留 `running`/`in_progress`。
- `[累积FR]` 本 line 暂无历史。
- `[回归测试]` `packages/brain/src/middleware/internal-auth.test.js` 覆盖 loopback 与远端 Bearer 鉴权。
- context-manifest: N/A（`journey_id=none`，无可查询 line）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节齐全，九角色恰好列全，不泄露凭据，不修改产品代码。 |
| Invariant（永不违反） | 不硬编码 token；不把远端无 Bearer 描述为可用；不把派发失败描述为仍运行。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 脚本解析文档结构和字面契约。 |
| 保质期（何时过期） | API、角色或状态契约变化时由对应代码变更维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 在文档缺失或契约漂移时阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一必备章节或负向约束缺失即验收失败，不降级放行。 |
| 效果确认（已发≠已生效） | HEAD 树存在目标文档，冻结测试与 E2E 对其内容和变更边界做断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、角色不全或错误描述鉴权/回滚 | 测试非零退出并阻塞验收 | 是 | 无降级 |
| 文档泄露疑似真实 token | 测试非零退出并阻塞验收 | 是 | 仅允许 `$CECELIA_INTERNAL_TOKEN` 占位符 |

### 输入对抗面

N/A — 本次不新增对外 agent 或输入接口。

## Golden Path

独立小路（无父路）

[阅读说明] → [按 Bearer 与 payload 发起 POST] → [按 id 发起 GET] → [判断派发或失败收口]

### Step 1: 找到两个桥接端点及鉴权方式
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 中文文档分别说明 POST 创建派发、GET 按 id 查询；明确 `internalAuthOrLoopback`，并明确宿主/远端缺少 Bearer 不可调用。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t '两个端点用途与远端 Bearer 缺失负向约束'
```
**硬阈值**: 测试 exit 0；文档同时包含两个端点、`Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，并明确远端缺失或无效 Bearer 会被拒绝。

### Step 2: 核对九项角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项。

**可观测行为**: 角色白名单独立列出且恰好为 `planner`、`proposer`、`critic`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`judge`、`reporter`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t '九项角色白名单恰好列全'
```
**硬阈值**: 列表集合与 PRD 九项逐字相等，无“等”省略。

### Step 3: 按 payload 约束构造请求
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档明确 `sprint_dir`、`base_repo`、`branch` 必填；`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填字段与 base_sha 省略语义'
```
**硬阈值**: 三个必填字段均出现，且 `base_sha` 不被描述为必填。

### Step 4: 识别派发失败已经收口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项及「边界情况」。

**可观测行为**: 文档明确派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，并明确不会继续保持 running/in_progress。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t '派发失败三对象终态且不保留 running'
```
**硬阈值**: 三个终态逐字出现，且存在“失败后不会仍为 running/in_progress”的负向说明。

## 真实调用方请求 shape

文档示例必须使用 `Authorization` header，值形态为 `Bearer $CECELIA_INTERNAL_TOKEN`；不得把 token 放入 JSON body。POST JSON body 仅陈述 role/title/payload 等桥接请求字段。本任务不真实调用端点，避免文档验收制造 attempt 副作用。

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块数据、生命周期或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只验证说明文档的准确与完整，不改变真实 API 接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 搜索文档是否把缺失 Bearer 的远端请求写成可调用。
- 重复提交: 搜索九项角色是否重复、遗漏或用“等”模糊省略。
- 中途中断: N/A（静态文档无运行中状态）。
- 边界值: 核对 `base_sha` 缺省与派发失败三对象终态。
发现分级: P0/P1（凭据泄露或错误放行）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: dev_pipeline
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
TEST=sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts
test -f "$DOC"
npx vitest run --no-cache "$TEST"
grep -q 'attempt-run 桥接使用说明' "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -Eq 'Authorization: Bearer .*CECELIA_INTERNAL_TOKEN' "$DOC"
grep -Eq 'run.*failed' "$DOC"
grep -Eq 'session.*closed' "$DOC"
grep -Eq 'task.*cancelled' "$DOC"
CHANGED=$(git diff --name-only 6496b3ba2e74f278f60fedb621127cde6c618108...HEAD | grep -vE '^(docs/current/attempt-run-bridge-guide\.md|sprints/coding-harness-20260901093400-iof74k/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests/attempt-run-bridge-guide\.test\.ts))$' || true)
[ -z "$CHANGED" ] || { echo "FAIL: 越界变更 $CHANGED"; exit 1; }
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts` | 两个端点用途与远端 Bearer 缺失负向约束；九项角色白名单恰好列全；payload 必填字段与 base_sha 省略语义；派发失败三对象终态且不保留 running | 目标文档尚不存在，4 个测试失败 |

