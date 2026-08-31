# Sprint Contract Draft (Round 1)

## 合同基线与范围

- 实现权威基线：`c04405fcfc1b5985b90273f52dbf0eee11b3888b`（来自 `inputs.implementation_baseline`；不以角色 checkout 之外的信息替换）。
- 唯一实现产物：`docs/current/attempt-run-bridge-guide.md`。
- 禁止修改代码、路由、鉴权、状态机、既有文档或测试；Sprint 冻结测试和合同产物不计入产品实现范围。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- Unified Map: `[MAP_NOT_CONFIGURED]`；本 bundle 未提供 map_scope/map_repo，故无 `must_run_assertions` 可导入。

## Response Schema（推导来源: N/A）

N/A — 本任务只新增使用说明文档，不改变或定义 HTTP 响应。

## 已知约束

- `[PRD]` 文档必须为简体中文，且只展示凭据变量名，禁止真实 token。
- `[PRD]` loopback 与宿主/远端鉴权边界必须分开陈述。
- `[实现基线] packages/brain/src/routes/harness-attempt-run.js` 的 `ALLOWED_ROLES` 精确为九项：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
- `[累积FR]` 本 line 暂无历史。
- context-manifest: N/A（`journey_id: none`）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，准确覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容与实现基线逐字对齐；唯一产品变更为一份 Markdown；不得泄露凭据。 |
| Invariant（永不违反） | 不改代码；不伪造角色别名；不把 loopback 写成远端免鉴权；不硬编码 secret。 |
| 判定点（怎么知道） | 由冻结 Vitest 与 E2E 文本解析精确核对。 |
| 保质期（何时过期） | 端点合同变化时由维护该路由的变更同步更新本文档。 |
| 死亡告警（停了谁知道） | Sprint/CI 文档合同测试失败即阻塞合并。 |
| 失败语义（挂了怎么办） | 缺项、错项、额外角色或实现范围越界均失败并阻塞合并，不降级放行。 |
| 效果确认（已发≠已生效） | 从提交树读取文档并对四节内容、角色全集和 diff 范围做机器断言。 |

### 判定点登记表

（本任务无真机或外部状态推断接缝，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或合同文本不完整 | 测试非零退出并阻塞合并 | 是，修正文档后重跑 | 无 |
| 角色集合增漏或顺序漂移 | 精确集合断言失败 | 是 | 无 |
| 产品 diff 出现非目标文件 | 范围断言失败 | 是 | 无 |

### 输入对抗面

N/A — 本任务不新增或修改对外 agent/API 输入面。

## 禁 mock 边清单

（本单为纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本任务仅记录既有桥接接口，不新增或改动调用 shape；文档必须按 PRD 字面区分 payload 的 `sprint_dir`、`base_repo`、`branch` 必填与 `base_sha` 可省略。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（纯文档交付，无需真机、第三方 API、异步消息或生产环境接缝，N/A。）

## Golden Path

独立小路（无父路）

[打开说明页] → [理解提交与查询] → [核对鉴权与九角色] → [按 payload 合同调用并理解失败回滚]

### Step 1: 操作者找到并打开中文说明页
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」及「预期受影响文件」。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在，标题为《attempt-run 桥接使用说明》，正文含中文。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!s.includes('# attempt-run 桥接使用说明')||!/[\\u4e00-\\u9fff]/u.test(s))process.exit(1)"
```

**硬阈值**: 目标文件 1 个，标题与中文字符断言均通过；以上命令 exit 0。

### Step 2: 操作者区分两个端点用途和鉴权边界
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1-2 项及边界情况。

**可观测行为**: 同页分别说明 POST 提交、GET 按 id 查询，并明确 loopback 与宿主/远端 Bearer 鉴权差异。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t '说明两个 attempt-run 端点的独立用途与鉴权边界'
```

**硬阈值**: 两个端点、`internalAuthOrLoopback`、`Bearer CECELIA_INTERNAL_TOKEN` 与两类调用位置全部命中；测试 exit 0。

### Step 3: 操作者核对精确九角色和 payload 字段
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3-4 项；九项字面值取自实现基线 `ALLOWED_ROLES`。

**可观测行为**: 「角色白名单」仅列精确九项；「payload 字段」分别标明三个必填字段，且 `base_sha` 可省略并由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t '角色白名单精确等于九个权威角色且无别名|payload 独立断言三个必填字段与 base_sha 可选自解析语义'
```

**硬阈值**: 角色数组与权威九项逐项、顺序完全相等；三个必填和一个可选语义全部命中；测试 exit 0。

### Step 4: 操作者理解派发失败自动回滚
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 项及边界情况。

**可观测行为**: 独立章节同时列出 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t '派发失败回滚精确覆盖 run session task 三个终态'
```

**硬阈值**: 三个对象及目标状态零缺项；测试 exit 0。

### Step 5: 交付保持纯文档范围
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转成防越界机器闸，避免实现阶段夹带代码变更。

**可观测行为**: 相对实现基线，产品实现 diff 只新增目标文档；合同与冻结测试之外无其他变化。

**验证命令**:
```bash
bash -c 'BAD=$(git diff --name-only c04405fcfc1b5985b90273f52dbf0eee11b3888b...HEAD | awk '\''$0 !~ /^(docs\/current\/attempt-run-bridge-guide.md|sprints\/coding-harness-20260831194600-evwsr3\/(contract-draft.md|contract-dod.md|task-plan.json|tests\/attempt-run-bridge-guide.test.ts))$/ {print}'\''); [ -z "$BAD" ] || { printf "%s\n" "$BAD"; exit 1; }'
```

**硬阈值**: 越界路径计数 = 0；命令 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（纯文档例外：不需要数据库或启动服务）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260831194600-evwsr3"
GUIDE="docs/current/attempt-run-bridge-guide.md"
BASE_SHA="c04405fcfc1b5985b90273f52dbf0eee11b3888b"

npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
node -e "const fs=require('fs');const s=fs.readFileSync('$GUIDE','utf8');if(!s.includes('# attempt-run 桥接使用说明')||!/[\\u4e00-\\u9fff]/u.test(s))process.exit(1)"
BAD=$(git diff --name-only "$BASE_SHA"...HEAD | awk -v sprint="$SPRINT_DIR" '$0 != "docs/current/attempt-run-bridge-guide.md" && $0 != sprint "/contract-draft.md" && $0 != sprint "/contract-dod.md" && $0 != sprint "/task-plan.json" && $0 != sprint "/tests/attempt-run-bridge-guide.test.ts" {print}')
[ -z "$BAD" ] || { echo "FAIL: 范围外文件"; printf '%s\n' "$BAD"; exit 1; }
git diff --name-status "$BASE_SHA"...HEAD -- "$GUIDE" | grep -qx $'A\tdocs/current/attempt-run-bridge-guide.md'
echo "OK: attempt-run 桥接说明合同通过"
```

**PASS**: 冻结测试全绿、文档为新文件、产品实现无范围外 diff，脚本 exit 0。  
**FAIL**: 任一内容断言、角色精确集合、payload 语义、回滚状态或范围断言失败，脚本非零退出。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误把 `base_sha` 写成必填。
- 重复提交: N/A（纯文档）。
- 中途中断: N/A（纯文档）。
- 边界值: 搜索是否出现第十个角色、角色别名或真实 token 样式。
发现分级: P0/P1（凭据泄露或错误 API 合同）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts` | `说明两个 attempt-run 端点的独立用途与鉴权边界`、`角色白名单精确等于九个权威角色且无别名`、`payload 独立断言三个必填字段与 base_sha 可选自解析语义`、`派发失败回滚精确覆盖 run session task 三个终态` | 目标文档尚不存在，4 个测试因 `ENOENT` 失败 |

## Notes

- 本合同不固定 GAN 作者 attempt/capability identity；未来 Evaluator/Judge 身份仅由 Runner 的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` 运行时变量提供。
- PRD 内旧假设基线 `88929fa...` 不具权威性；本合同严格使用 bundle 的 `inputs.implementation_baseline.base_sha=c04405fc...`。
