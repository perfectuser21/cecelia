# Sprint Contract Draft (Round 1)

## 合同基线与范围

- 权威实现基线：`1f5a9d46838c3422c75cf2dc75c9f9abebf77cf8`（来自 `inputs.implementation_baseline.base_sha`，不得由角色 checkout SHA 替换）。
- 只允许新增 `docs/current/attempt-run-bridge-guide.md`；不得修改代码、配置、既有测试或其他文档。
- contract-gate: 使用 Cecelia 仓 `packages/brain/src/lib/contract-gate.js`。
- gp-anchor: skipped (product-map.json not found)
- Unified Map：`map_scope` 为空，标记 `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`。

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增说明文档，不改变 HTTP 响应或数据库结构。文档中的端点事实取自实施基线 `packages/brain/src/routes/harness-attempt-run.js`。

## 已知约束（来自回归测试与累积 FR）

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 路由包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 区分 loopback、未配置 token 与远端鉴权。
- [累积FR] 本 line 暂无历史。
- context-manifest: journey_id 为 none，不存在可查询的业务 line manifest。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，准确覆盖端点用途、鉴权、九项角色、payload 与派发失败回滚。 |
| NFR（做得多好） | 内容可独立使用；九项角色逐项列明；四类事实均可由冻结测试机检。 |
| Invariant（永不违反） | 不泄露 token 值、不修改代码、不将远端描述成免鉴权、不将 `base_sha` 写成必填。 |
| 判定点（怎么知道） | 见下方登记表；事实与实施基线源代码逐字核对。 |
| 保质期（何时过期） | 路由、角色白名单、payload 或回滚实现变化时，本页需同步更新。 |
| 死亡告警（停了谁知道） | 冻结 Vitest 与合同 E2E 在内容漂移或缺失时非零退出，由 CI 报告。 |
| 失败语义（挂了怎么办） | 任一必要章节或精确值缺失即阻塞交付，不降级为模糊说明。 |
| 效果确认（已发≠已生效） | 读取实际文档并逐项断言内容，不以文件存在代替内容正确。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不完整 | Vitest/E2E 非零退出，阻塞交付 | 是，补正文后可重复验证 | 无降级 |
| 服务端事实与 PRD 冲突 | 以权威实现基线核实并上报合同阻塞 | 是 | 不猜测、不扩写 |

### 输入对抗面

N/A — 本 Sprint 不新增或修改对外 agent 接口，只记录既有接口用法。

## 真实调用方请求 shape

N/A — 本 Sprint 不改变调用方或接口 shape；文档只要求远端请求使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，并列出既有 POST payload 字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A）

## 接缝清单

（本单纯文档改动，不执行真实服务、真机或第三方操作，N/A）

## Golden Path

独立小路（无父路）

[阅读说明] → [识别端点与鉴权] → [选择合法角色并构造 payload] → [理解派发失败收口]

### Step 1: 找到中文说明并识别两个端点用途
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 标题为《attempt-run 桥接使用说明》，并分别说明 POST 发起与 GET 查询用途。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t '文档位于 docs/current 且为中文说明|两个端点用途与 internalAuthOrLoopback 鉴权说明完整'
```
**硬阈值**: 两个用例均通过，exit code = 0。

### Step 2: 按调用位置使用正确鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项及「边界情况」。

**可观测行为**: 文档明确两端点使用 `internalAuthOrLoopback`，宿主或远端必须携带 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`，不声称远端可免鉴权。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t '两个端点用途与 internalAuthOrLoopback 鉴权说明完整'
```
**硬阈值**: 用例通过，exit code = 0。

### Step 3: 从九项白名单选择角色
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项；精确名称由权威基线 `ALLOWED_ROLES` 核实。

**可观测行为**: 文档独立章节按服务端顺序列出且仅列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t '角色白名单完整列出九项且没有额外角色'
```
**硬阈值**: 角色数组精确相等，数量 = 9，exit code = 0。

### Step 4: 构造 payload 并理解 base_sha 解析责任
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 文档把 `sprint_dir`、`base_repo`、`branch` 标成必填，把 `base_sha` 标成可省略且由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t 'payload 必填字段与 base_sha 省略语义完整'
```
**硬阈值**: 三个必填字段及一项可省略语义全部命中，exit code = 0。

### Step 5: 识别派发失败后的闭环状态
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5 项。

**可观测行为**: 文档明确派发失败自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts -t '派发失败自动回滚三层状态完整'
```
**硬阈值**: 三层状态全部命中，exit code = 0。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（任务 payload 显式路由；本次为文档静态验收，无 UI 或服务启动）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR='sprints/coding-harness-20260831142046-muda2u'
DOC='docs/current/attempt-run-bridge-guide.md'
BASE_SHA='1f5a9d46838c3422c75cf2dc75c9f9abebf77cf8'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD | grep -vE "^($SPRINT_DIR/(contract-draft.md|contract-dod.md|task-plan.json|tests/attempt-run-bridge-guide.test.ts)|docs/current/attempt-run-bridge-guide.md)$" || true)
[ -z "$CHANGED" ] || { echo "FAIL: 越界文件 $CHANGED"; exit 1; }
node -e "const fs=require('fs');const p=process.argv[1];const s=fs.readFileSync(p,'utf8');if(!s.includes('attempt-run 桥接使用说明'))process.exit(1)" "$DOC"
echo 'attempt-run 桥接使用说明验收通过'
```

通过标准：完整脚本 exit code = 0；任何测试或范围检查失败均为 FAIL。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `base_sha` 列为必填，或省略任一真正必填字段。
- 重复提交: 检查九项角色是否重复、漏项或出现服务端不支持的额外角色。
- 中途中断: N/A，静态文档无进行中状态。
- 边界值: 检查 loopback 与宿主/远端条件是否混写，token 仅写变量名而非真实值。
发现分级: P0/P1（泄露凭据、错误鉴权或错误接口合同）阻塞 merge；P2/P3 记录 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 文档位置与中文标题 | `sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts` | 文档位于 docs/current 且为中文说明 | 目标文档尚不存在，读取时报 ENOENT |
| 端点与鉴权 | `sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts` | 两个端点用途与 internalAuthOrLoopback 鉴权说明完整 | 目标文档尚不存在，读取时报 ENOENT |
| 九项角色 | `sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts` | 角色白名单完整列出九项且没有额外角色 | 目标文档尚不存在，读取时报 ENOENT |
| payload 合同 | `sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts` | payload 必填字段与 base_sha 省略语义完整 | 目标文档尚不存在，读取时报 ENOENT |
| 失败回滚 | `sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-guide.test.ts` | 派发失败自动回滚三层状态完整 | 目标文档尚不存在，读取时报 ENOENT |
