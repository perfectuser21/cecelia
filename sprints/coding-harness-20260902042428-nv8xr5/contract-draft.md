# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 本 Sprint 仅新增文档，不新增或修改 HTTP 响应。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 既有路由测试覆盖 `/attempt-run` 与 `/attempt-run/:attemptId`。
- [packages/brain/src/middleware/internal-auth.test.js] → 既有测试覆盖 `internalAuthOrLoopback` 的 loopback 与 token 行为。
- [累积FR] 本 line 暂无历史。
- Unified Map: `[MAP_NOT_CONFIGURED]`；无 `must_run_assertions`、fact revisions 或 freshness 可载入。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节齐全且可由冻结测试机械验收；不修改代码。 |
| Invariant（永不违反） | 不硬编码 token；不把 `base_sha` 写成必填；实现 diff 仅含目标文档。 |
| 判定点（怎么知道） | 由文档内容测试和基线 diff 精确判定。 |
| 保质期（何时过期） | 端点契约变化时由 Brain 路由维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 发现缺节、字段漂移或范围越界即阻塞 CI。 |
| 失败语义（挂了怎么办） | 任一内容断言失败即不接受文档；不降级放行。 |
| 效果确认（已发≠已生效） | 从 git 树读取最终文档并逐节断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或事实不全 | 测试失败并阻塞交付 | 是 | 无降级 |
| 实现范围出现代码或其他文件 | diff 断言失败并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入面。

## 判定点登记表

（本任务无接缝判定点，N/A）

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [理解端点与鉴权] → [核对角色与 payload] → [理解派发失败回滚]

### Step 1: 找到中文桥接说明并理解两个端点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项与「范围限定」。

**可观测行为**: `docs/current/attempt-run-bridge-usage.md` 是中文文档，分别说明 POST 创建/派发与 GET 按 id 查询的用途。

**验证命令**: `node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8'); for(const s of ['attempt-run 桥接使用说明','POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id']) if(!f.includes(s)) process.exit(1)"`

**硬阈值**: 标题与两个端点逐字出现，命令 exit 0。

### Step 2: 按正确鉴权方式调用
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 文档说明两端点采用 `internalAuthOrLoopback`，并明确宿主/远端携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**验证命令**: `node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8'); if(!f.includes('internalAuthOrLoopback')||!/Authorization:\s*Bearer\s+\$CECELIA_INTERNAL_TOKEN/.test(f)) process.exit(1)"`

**硬阈值**: 中间件名和 Bearer 示例均存在，命令 exit 0。

### Step 3: 选择白名单角色并填写 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2、3 项。

**可观测行为**: 文档完整列出冻结 PRD 指定的九个角色，说明白名单外角色不接受；明确三个必填字段及 `base_sha` 省略语义。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts`

**硬阈值**: 九项角色恰好完整覆盖；三个字段均标为必填；`base_sha` 标为可省略并由生产 Brain 解析。

### Step 4: 识别派发失败后的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档将派发失败后的三类最终状态完整写为 `run → failed`、`session → closed`、`task → cancelled`。

**验证命令**: `node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8'); for(const r of [/run\s*(?:→|->)\s*failed/,/session\s*(?:→|->)\s*closed/,/task\s*(?:→|->)\s*cancelled/]) if(!r.test(f)) process.exit(1)"`

**硬阈值**: 三个对象及目标状态全部出现，命令 exit 0。

### Step 5: 保持文档-only 实现边界
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转成不可借其他文件绕过的机械断言。

**可观测行为**: 相对实现基线 `f9634a9c99096d934044cf1f6ab968627cf4e82c`，实现提交只新增目标文档；Sprint 合同产物除外。

**验证命令**: `bash -c 'git diff --name-only f9634a9c99096d934044cf1f6ab968627cf4e82c...HEAD | grep -v "^sprints/coding-harness-20260902042428-nv8xr5/" | diff -u <(printf "%s\n" docs/current/attempt-run-bridge-usage.md) -'`

**硬阈值**: 排除冻结合同产物后，diff 文件集合严格等于目标文档。

## 真实调用方请求 shape

N/A — 本 Sprint 不调用端点，仅记录 PRD 冻结的调用方式。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块数据传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A；PRD 明确禁止实际调用 attempt-run 端点。）

## 接缝清单

无。本 Sprint 只验收 git 中的静态中文说明，不触碰真实端点或生产环境。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误称白名单外角色可用。
- 重复提交: 检查同一事实在不同章节是否相互矛盾。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查 `base_sha` 是否被误归入必填字段。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-usage.md
BASE_SHA=f9634a9c99096d934044cf1f6ab968627cf4e82c
test -f "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts
git diff --name-only "$BASE_SHA"...HEAD | grep -v '^sprints/coding-harness-20260902042428-nv8xr5/' > /tmp/attempt-run-implementation-files.txt
diff -u <(printf '%s\n' "$DOC") /tmp/attempt-run-implementation-files.txt
echo 'attempt-run 桥接使用说明验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中文说明四节及实现边界 | `sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts` | `说明两个端点及鉴权方式`；`列出九项角色白名单`；`区分 payload 必填字段与可省略 base_sha`；`说明派发失败的三对象回滚状态` | 目标文档尚不存在，4 个测试均失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `f9634a9c99096d934044cf1f6ab968627cf4e82c`（始终不采用 role checkout SHA 替换）
