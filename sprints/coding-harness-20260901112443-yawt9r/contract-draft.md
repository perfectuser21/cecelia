# Sprint Contract Draft (Round 1) — attempt-run 桥接使用说明

## Response Schema（推导来源: PRD 字面）

N/A — 本 Sprint 只新增使用说明，不新增或修改 HTTP 响应。文档必须按 PRD 字面保留两个端点、字段名、角色名与回滚状态；不得借文档改变 API 合同。

## 已知约束（来自回归测试与历史上下文）

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 路由同时注册 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 对 loopback 与 Bearer token 的既有鉴权行为受回归保护。
- [tests/gp/f1/step3-attempt-run-endpoint.test.js] → attempt-run 端点已有 Golden Path 守卫，本 Sprint 不修改该实现。
- [累积 FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`；task payload 未提供可用 map_scope/map_repo，`must_run_assertions=[]`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增一页中文说明，覆盖端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 一页可操作中文说明；四类信息均由冻结测试机械解析。 |
| Invariant（永不违反） | 不改代码、配置和既有文档；不展示真实 token；不把 `base_sha` 写成必填。 |
| 判定点（怎么知道） | 以文档字面与唯一交付路径的 Vitest 断言判定。 |
| 保质期（何时过期） | 端点合同变化时由对应代码变更维护者同步更新本页。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或合同字段漂移时立即失败并阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一内容断言或唯一文件断言失败即 fail-closed，不接受部分覆盖。 |
| 效果确认（已发≠已生效） | 直接读取提交树中的中文文档并逐项断言，不以文件存在代替内容正确。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失、字段缺项或多改文件 | 测试非零退出并阻塞交付 | 是 | 无降级，修正文档后重跑 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入入口。

gp-anchor: skipped (product-map.json not found)

## 禁 mock 边清单

（本单纯文档改动，无调度、状态机、跨模块、生命周期或 DB 写入边，N/A）

## 真实调用方请求 shape

N/A — 本 Sprint 不改变调用 shape；文档仅按冻结 PRD 记录 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 及 payload 字段，不执行真实派发以避免产生业务副作用。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

独立小路（无父路）

[读者打开中文说明] → [确认两个端点及鉴权] → [按九项角色与 payload 合同构造请求] → [查询并辨别已派发或三对象失败回滚]

### Step 1: 找到说明并理解两个端点用途
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、6 步。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 为中文，并明确 POST 用于创建并派发、GET 用于按 id 查询状态。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整"`

**硬阈值**: 指定测试 1/1 通过，exit code=0。

### Step 2: 使用正确鉴权与角色
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2、3 步与边界情况。

**可观测行为**: 文档说明 `internalAuthOrLoopback`，宿主机/远端必须携带 Bearer 环境变量占位符，并逐项列出且仅承诺九项白名单角色。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单逐项列全且无缺项"`

**硬阈值**: 九项角色全部命中，测试 exit code=0；文档不得含真实 token 值。

### Step 3: 按 payload 合同构造创建请求
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 标成必填，把 `base_sha` 标成可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 可省略语义完整"`

**硬阈值**: 三个必填字段与一个省略语义全部命中，测试 exit code=0。

### Step 4: 辨别派发失败的完整回滚结果
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、6 步。

**可观测行为**: 文档同时说明 `run → failed`、`session → closed`、`task → cancelled`，不允许部分回滚描述。

**验证命令**: `npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚三对象最终状态完整"`

**硬阈值**: 三个对象/状态对全部命中，测试 exit code=0。

### Step 5: 保持纯文档范围
**来源**: `[AI_ADDED]` — 将 PRD“只新增一页且不改代码”转为防范围漂移的提交树断言。

**可观测行为**: 相对冻结实现基线，`docs/current/` 唯一新增交付文件为目标说明，且没有代码文件变化。

**验证命令**: `bash -c 'test "$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750 -- docs/current | sort)" = "docs/current/attempt-run-bridge-guide.md"; test -z "$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750 -- packages apps scripts -- "*.js" "*.ts" "*.tsx" "*.cjs" "*.mjs")"'`

**硬阈值**: docs/current 交付 diff 恰为 1 个目标文件；产品代码 diff 为 0。

## 接缝清单

（纯文档交付不触碰真机、第三方、异步或生产环境接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误称缺 Bearer 的远端请求可访问。
- 重复提交: 检查四节是否重复且互相矛盾。
- 中途中断: N/A（静态文档）。
- 边界值: 检查九项角色恰好逐项出现，`base_sha` 未被写成必填。
发现分级: P0/P1（泄露凭据或错误放行鉴权）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260901112443-yawt9r"
BASE_SHA="d4ae8c6d2b777f5762c4cd88a8e8d56004c66750"
GUIDE="docs/current/attempt-run-bridge-guide.md"
npx vitest run "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
test "$(git diff --name-only "$BASE_SHA" -- docs/current | sort)" = "$GUIDE"
test -z "$(git diff --name-only "$BASE_SHA" -- packages apps scripts -- '*.js' '*.ts' '*.tsx' '*.cjs' '*.mjs')"
node -e "const s=require('fs').readFileSync('$GUIDE','utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"
echo "attempt-run 桥接使用说明 E2E 通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接使用说明 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途与 internalAuthOrLoopback 鉴权说明完整` / `九项角色白名单逐项列全且无缺项` / `payload 必填字段与 base_sha 可省略语义完整` / `派发失败自动回滚三对象最终状态完整` | 4 tests fail：目标文档不存在，`ENOENT` |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- validation identity: evaluator/judge 必须使用 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`；本合同不固化任何角色 attempt 或 capability UUID。
