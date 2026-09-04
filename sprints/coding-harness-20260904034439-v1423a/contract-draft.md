# Sprint Contract Draft（Round 1）

## 范围与证据来源

- 权威实现基线：`bdaca81b5cbf78929fa3d8eeac2a24cae6113b98`；该值跨角色、跨 GAN 轮次保持不变，角色 checkout 的 workspace base SHA 不得替代它。
- PRD 正文：`inputs.thin_prd` 优先，`sprint-prd.md` 补充边界。
- Unified Map：`[MAP_NOT_CONFIGURED]`（task payload 未配置有效的 `map_scope`/`map_repo`）；`must_run_assertions` 为空，禁止用领域硬编码替代。
- Registry：API、DB、测试 registry 于 2026-09-04 扫描结果为 fresh；本单不定义 HTTP response schema 或 DB schema，测试采用 registry 所示 Vitest 风格。
- GP Anchor：`gp-anchor: skipped (product-map.json not found)`。
- Contract Gate：使用 Cecelia 仓库 `packages/brain/src/lib/contract-gate.js`。

## Response Schema（推导来源: PRD 字面）

N/A — 本任务只新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与历史上下文）

- [`packages/brain/src/middleware/internal-auth.test.js`] → `internalAuthOrLoopback` 区分 loopback 与受 token 保护来源；文档不得写成所有来源免鉴权。
- `[累积FR]` 本 line 暂无历史；`context-manifest: unavailable`。
- `[MAP_NOT_CONFIGURED]` 无 Map 回归断言可追加。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增一页中文说明，覆盖两个端点、鉴权、九角色、payload/base_sha 与失败回滚。 |
| NFR（做得多好） | 字面准确，四个可定位章节；实现基线 canonical diff 中不出现代码改动。 |
| Invariant（永不违反） | 不改变 API、DB、鉴权、派发行为；实现基线不被 workspace base SHA 替代。 |
| 判定点（怎么知道） | 无外部状态推断，见下方 N/A。 |
| 保质期（何时过期） | 端点契约变化时由 Harness 维护者同步修订。 |
| 死亡告警（停了谁知道） | 文档契约测试在 Sprint Tests 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一章节、封闭清单或范围 oracle 不满足即 fail-closed。 |
| 效果确认（已发≠已生效） | 读取候选 HEAD 的真实文档，并以内容断言和 canonical diff 双重确认。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不完整 | 验收退出非零并阻塞合并 | 是 | 无降级，不接受部分成功 |
| canonical diff 出现范围外文件 | 验收退出非零并阻塞合并 | 是 | 删除越界改动后重验 |

### 输入对抗面

N/A — 本任务不新增对外 Agent 或输入入口。

## 禁 mock 边清单

（本单为纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 真实调用方请求 shape

N/A — 本单只记录冻结 PRD 指定的调用契约，不新增或修改真实调用方。

## Golden Path

独立小路（无父路）

[阅读说明] → [选择创建或查询端点并正确鉴权] → [按九角色及 payload 约束组装请求] → [理解成功或失败回滚出口]

### Step 1：定位两个端点及鉴权边界

**来源**: `[FROM_PRD]` — 「内容必须覆盖」第 1 项。

**可观测行为**: 中文文档分别解释 POST 创建与 GET 查询，并说明 `internalAuthOrLoopback`；宿主/远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，不得把 loopback 规则写成普遍免鉴权。

**验证命令**: `node -e` 读取真实文档并同时断言两个端点、用途、鉴权名和 Bearer 字面。

**硬阈值**: 正向封闭清单恰好 6 项：POST、创建用途、GET、查询用途、internalAuthOrLoopback、Bearer token；负向 oracle 禁止出现“宿主或远端无需鉴权”。

### Step 2：列出角色白名单

**来源**: `[FROM_PRD]` — 「角色白名单九项」。

**可观测行为**: 角色封闭清单恰好 9 项：`planner`、`proposer`、`proposer-critic`、`generator`、`generator-critic`、`evaluator`、`evaluator-critic`、`reporter`、`reporter-critic`。

**验证命令**: `node -e` 从“角色白名单”章节提取反引号角色，排序后与上述 9 项逐字相等。

**硬阈值**: 集合大小恰好 9 且零缺失；负向 oracle 保证不存在第 10 个角色。

### Step 3：组装 payload 并保持实现基线

**来源**: `[FROM_PRD]` — 「payload 必填字段」第 3 项及 PRD Golden Path 第 4 步。

**可观测行为**: 必填字段封闭清单恰好 3 项：`sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析，且实现基线跨角色/GAN 不变，workspace base SHA 不得替代实现基线。

**验证命令**: `node -e` 提取必填字段列表并与 3 项集合逐字相等，同时断言可省略、自解析与基线不变句。

**硬阈值**: 必填集合恰好 3；负向 oracle 禁止 `base_sha` 进入必填集合或出现“角色切换可重置实现基线”。

### Step 4：识别派发失败回滚出口

**来源**: `[FROM_PRD]` — 「派发失败自动回滚」第 4 项。

**可观测行为**: 回滚终态封闭清单恰好 3 项：`run→failed`、`session→closed`、`task→cancelled`，不得描述为部分成功。

**验证命令**: `node -e` 提取回滚章节的三项映射并逐字比对。

**硬阈值**: 三项全部且仅出现一次；负向 oracle 禁止“部分成功”。

### Step 5：范围保持为单文档实现

**来源**: `[AI_ADDED]` — 将 PRD“不改任何代码”转成不可由工作区历史状态绕过的 canonical diff oracle。

**可观测行为**: 相对权威实现基线，候选交付仅新增一个 `docs/current/*.md` 实现文件；允许本 Sprint 的冻结合同、测试与 task-plan，禁止其他文件及所有代码后缀。

**验证命令**: `git diff --name-only bdaca81b5cbf78929fa3d8eeac2a24cae6113b98...HEAD` 取得全仓 canonical 范围后逐项分类。

**硬阈值**: `docs/current/*.md` 恰好 1；实现代码恰好 0；范围外文件恰好 0。负向 oracle 对任一不匹配立即退出非零。

## 断言总数与自洽推演

共 15 个原子断言：B-01 正向 6/负向 1，B-02 正向 1/负向 1，B-03 正向 3/负向 1，B-04 正向 1/负向 1，B-05 canonical 范围 1。两两推演结论：九角色“存在”与“恰好九项”共享同一封闭集合；三必填字段“存在”与“base_sha 非必填”共享同一封闭集合；三回滚终态“存在”与“不得部分成功”不冲突；单文档存在与全仓 diff 恰好一份实现文档一致。所有正向 oracle 均有相邻负向 oracle，数量断言与存在断言无冲突。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `base_sha` 列为必填。
- 重复提交: 检查角色或回滚项重复是否会被封闭集合 oracle 捕获。
- 中途中断: N/A，静态文档无异步过程。
- 边界值: 检查第十个角色或第四个必填字段能否触发失败。
发现分级: P0/P1（错误指导远端调用或基线漂移）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（按 PRD 显式值；验收本身为仓库静态合同）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98
SPRINT_DIR=sprints/coding-harness-20260904034439-v1423a
GUIDE=docs/current/attempt-run-bridge-guide.md
test -f "$GUIDE"
node - "$GUIDE" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const section = (name, next) => { const start = text.indexOf(name); if (start < 0) throw new Error(`缺章节: ${name}`); const end = next ? text.indexOf(next, start + name.length) : text.length; return text.slice(start, end < 0 ? text.length : end); };
const endpoints = section('## 端点与鉴权', '## 角色白名单');
for (const value of ['POST /api/brain/harness/attempt-run', '创建', 'GET /api/brain/harness/attempt-run/:id', '查询', 'internalAuthOrLoopback', 'Bearer CECELIA_INTERNAL_TOKEN']) if (!endpoints.includes(value)) throw new Error(`端点/鉴权缺失: ${value}`);
if (/宿主或远端.{0,12}(无需|免)鉴权/.test(endpoints)) throw new Error('远端免鉴权错误');
const roles = [...section('## 角色白名单', '## payload 与实现基线').matchAll(/`([a-z-]+)`/g)].map(m => m[1]);
const expectedRoles = ['evaluator','evaluator-critic','generator','generator-critic','planner','proposer','proposer-critic','reporter','reporter-critic'];
if (roles.length !== 9 || JSON.stringify([...roles].sort()) !== JSON.stringify(expectedRoles)) throw new Error(`角色白名单并非恰好九项: ${roles}`);
const payload = section('## payload 与实现基线', '## 派发失败自动回滚');
const required = [...payload.matchAll(/^\s*- `([^`]+)`：必填/mg)].map(m => m[1]).sort();
if (JSON.stringify(required) !== JSON.stringify(['base_repo','branch','sprint_dir'])) throw new Error(`必填字段并非恰好三项: ${required}`);
for (const value of ['`base_sha` 可省略', '生产 Brain', '实现基线', '保持不变', 'workspace', '不得替代']) if (!payload.includes(value)) throw new Error(`基线规则缺失: ${value}`);
if (/`base_sha`：必填|角色切换可重置实现基线/.test(payload)) throw new Error('base_sha 规则写反');
const rollback = section('## 派发失败自动回滚');
for (const value of ['run→failed','session→closed','task→cancelled']) if ((rollback.split(value).length - 1) !== 1) throw new Error(`回滚映射须恰好出现一次: ${value}`);
if (rollback.includes('部分成功')) throw new Error('派发失败不得描述为部分成功');
if (!/[\u4e00-\u9fff]/.test(text)) throw new Error('文档必须为中文');
NODE
mapfile -t CHANGED < <(git diff --name-only "$BASE_SHA"...HEAD)
DOCS=0
OUTSIDE=0
for file in "${CHANGED[@]}"; do
  case "$file" in
    docs/current/*.md) DOCS=$((DOCS+1)) ;;
    "$SPRINT_DIR"/contract-draft.md|"$SPRINT_DIR"/contract-dod.md|"$SPRINT_DIR"/task-plan.json|"$SPRINT_DIR"/tests/*.test.ts) ;;
    *) OUTSIDE=$((OUTSIDE+1)); echo "范围外文件: $file" ;;
  esac
done
[ "$DOCS" -eq 1 ]
[ "$OUTSIDE" -eq 0 ]
if printf '%s\n' "${CHANGED[@]}" | grep -Eq '\.(js|cjs|mjs|ts|tsx|jsx|py|sql)$' | grep -v "^$SPRINT_DIR/tests/"; then exit 1; fi
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明冻结契约 | `sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts` | `B-01 两个端点、用途与鉴权边界完整`；`B-02 角色白名单恰好九项且无额外角色`；`B-03 payload 必填字段与 base_sha 基线规则完整`；`B-04 派发失败回滚三对象终态完整` | 目标文档不存在，4 个测试因 `ENOENT` 失败 |
