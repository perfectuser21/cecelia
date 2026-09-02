# Sprint Contract Draft (Round 3)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试与历史约束）

- [PRD Invariant/规划分支] 本合同分支由 Harness 签发，不切换到 main。
- [PRD Invariant/凭据安全] 文档只能引用环境变量名，不得出现真实 token。
- [PRD Invariant/端点鉴权] 两个端点均须说明 `internalAuthOrLoopback` 与远端 Bearer 鉴权。
- [PRD Invariant/真环境验证] N/A：本 sprint 不调用端点，只机械验收静态中文说明。
- [累积 FR] 本 line 暂无历史；未提供 journey_id，context-manifest 不适用。
- [现有实现] `packages/brain/src/routes/harness-attempt-run.js` 是端点用途、鉴权与回滚语义的核对来源；本 sprint 不修改该文件。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-usage.md` 新增中文说明，完整覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 四节均可由测试逐项定位；除目标文档外不改实现文件。 |
| Invariant（永不违反） | 不写入真实凭据；不把 `base_sha` 写成必填；不遗漏三种回滚终态。 |
| 判定点（怎么知道） | 以文档标题、章节及冻结字面量的自动断言判定。 |
| 保质期（何时过期） | 当 attempt-run 路由契约变化时由该路由维护者同步更新。 |
| 死亡告警（停了谁知道） | Sprint Tests 在文档缺失或契约字面量回退时立即失败。 |
| 失败语义（挂了怎么办） | 任一必需章节、角色、字段或状态缺失即验收失败，禁止部分通过。 |
| 效果确认（已发≠已生效） | 测试读取提交树中的真实文档并验证全部约束及唯一实现产物 diff。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或内容不全 | 测试非零退出并阻塞交付 | 是 | 不降级为部分说明 |
| 文档出现疑似真实 Bearer 值 | 测试失败 | 是 | 仅保留 `$CECELIA_INTERNAL_TOKEN` 占位引用 |
| 目标文档外出现实现变更 | diff 范围检查失败 | 是 | 删除越界变更 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入入口。

gp-anchor: skipped (product-map.json not found)

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 sprint 不发起请求；文档只说明生产调用方式。鉴权字面约束为宿主/远端请求携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，且 PRD 明确排除实际调用 attempt-run 端点，N/A。）

## Golden Path

独立小路（无父路）

[读者打开说明] → [确认两个端点与鉴权] → [核对九项角色及 payload] → [理解派发失败回滚]

### Step 1: 找到中文说明并识别两个端点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项及「范围限定」。

**可观测行为**: `docs/current/attempt-run-bridge-usage.md` 标题为《attempt-run 桥接使用说明》，分别解释 POST 创建/派发及 GET 按 id 查询用途。

**硬阈值**: 文档存在、中文标题存在、两个方法与路径均逐字出现。

**验证命令**: `node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8'); for(const x of ['attempt-run 桥接使用说明','POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id']) if(!f.includes(x)) process.exit(1)"`

### Step 2: 按说明采用正确鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项与边界情况。

**可观测行为**: 读者可区分 Brain 本机 loopback 与宿主/远端调用；宿主/远端示例要求 Bearer 环境变量。

**硬阈值**: `internalAuthOrLoopback`、`Authorization`、`Bearer`、`CECELIA_INTERNAL_TOKEN` 均出现，且不得包含 32 字符以上疑似硬编码 Bearer 凭据。

**验证命令**: `node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8'); for(const x of ['internalAuthOrLoopback','Authorization','Bearer','CECELIA_INTERNAL_TOKEN']) if(!f.includes(x)) process.exit(1); if(/Bearer\\s+[A-Za-z0-9_-]{32,}/.test(f)) process.exit(1)"`

### Step 3: 构造角色与 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2、3 项。

**可观测行为**: 文档列出且仅将 planner、proposer、challenger、generator、evaluator、judge、fixer、reporter、merger 描述为九项白名单，并明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略且由生产 Brain 自解析。

**硬阈值**: 文档必须以 `## 角色白名单` 独立章节按固定顺序逐行列出且仅列出九项角色：planner、proposer、challenger、generator、evaluator、judge、fixer、reporter、merger；三个必填字段和 `base_sha` 省略语义必须归属 `## payload 字段` 独立章节。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts`

### Step 4: 识别派发失败后的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: 文档在同一失败回滚章节完整呈现 `run→failed`、`session→closed`、`task→cancelled`，防止部分创建状态被误判为可执行。

**硬阈值**: 三条状态迁移均逐字出现，缺一即失败。

**验证命令**: `node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8'); for(const x of ['run→failed','session→closed','task→cancelled']) if(!f.includes(x)) process.exit(1)"`

### Step 4a: 保持四类内容的章节归属
**来源**: `[AI_ADDED]` — Reviewer 要求四类内容分别归属独立章节，防止关键词散落全文造成假绿。

**可观测行为**: 文档恰有 `## 端点用途与鉴权`、`## 角色白名单`、`## payload 字段`、`## 派发失败自动回滚` 四个独立内容章节；各冻结内容仅由对应章节验收。

**硬阈值**: 四个二级章节均存在；端点与鉴权、精确九角色、payload 字段、三类回滚分别在所属章节内通过断言。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts`

### Step 5: 保持实现范围不变
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转为防越界的提交树断言。

**可观测行为**: 相对权威实现基线 `f9634a9c99096d934044cf1f6ab968627cf4e82c`，实现产物仅新增目标说明；合同冻结产物位于本 sprint 目录。

**硬阈值**: 排除本 sprint 合同产物后，diff 仅含 `docs/current/attempt-run-bridge-usage.md`。

**验证命令**: `bash -c 'git diff --name-only f9634a9c99096d934044cf1f6ab968627cf4e82c...HEAD | grep -v "^sprints/coding-harness-20260902042428-nv8xr5/" | diff -u <(printf "%s\\n" docs/current/attempt-run-bridge-usage.md) -'`

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-usage.md
BASE_SHA=f9634a9c99096d934044cf1f6ab968627cf4e82c
test -f "$DOC"
node - <<'NODE'
const fs = require('fs');
const f = fs.readFileSync('docs/current/attempt-run-bridge-usage.md', 'utf8');
const required = [
  'attempt-run 桥接使用说明',
  'POST /api/brain/harness/attempt-run',
  'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback',
  'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  'planner', 'proposer', 'challenger', 'generator', 'evaluator', 'judge', 'fixer', 'reporter', 'merger',
  'sprint_dir', 'base_repo', 'branch', 'base_sha', '可省略', '生产 Brain', '自解析',
  'run→failed', 'session→closed', 'task→cancelled',
];
for (const value of required) {
  if (!f.includes(value)) throw new Error(`文档缺少冻结要求: ${value}`);
}
if (/Bearer\s+[A-Za-z0-9_-]{32,}/.test(f)) throw new Error('文档疑似硬编码真实 Bearer 凭据');
NODE
npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts
mapfile -t implementation_files < <(git diff --name-only "$BASE_SHA"...HEAD | grep -v '^sprints/coding-harness-20260902042428-nv8xr5/')
[ "${#implementation_files[@]}" -eq 1 ]
[ "${implementation_files[0]}" = "$DOC" ]
echo 'attempt-run 桥接使用说明验收通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误称 `base_sha` 必填，或将白名单外角色写成可接受。
- 重复提交: 搜索九个角色是否有重复、遗漏或混入第十项。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查 loopback、宿主、远端三种访问位置的鉴权表述是否无歧义。
发现分级: P0/P1（泄露凭据或错误指导生产调用）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接中文说明 | `sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts` | `包含两个端点用途与鉴权要求`、`包含且仅声明冻结的九项角色白名单`、`包含 payload 必填字段与 base_sha 省略语义`、`包含派发失败的三类回滚终态` | 文档尚不存在，4 个测试均因 ENOENT 失败 |

## Notes

- contract-gate: applicable (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `f9634a9c99096d934044cf1f6ab968627cf4e82c`（全过程保持不变）
