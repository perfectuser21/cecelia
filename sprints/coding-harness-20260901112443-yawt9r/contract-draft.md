# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [sprint-prd.md / Invariant] 凭据不得硬编码、进入 Git 或日志；文档示例只能引用环境变量 `CECELIA_INTERNAL_TOKEN`。
- [packages/brain/src/middleware/internal-auth.test.js] → `internalAuthOrLoopback` 对 loopback 与 Bearer 鉴权已有回归约束，本 Sprint 不修改实现。
- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → attempt-run 两个路由已有注册约束，本 Sprint 不修改实现。
- [累积FR] 本 line 暂无历史。
- [Unified Map] `[MAP_NOT_CONFIGURED]`：task 未提供可用的 map_scope/map_repo 组合，无 must_run_assertions。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点用途、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 四类内容完整且可由冻结测试逐项解析；不得改代码或既有文档。 |
| Invariant（永不违反） | 不展示真实 token；不把白名单外角色或缺字段请求描述为有效；不修改实现。 |
| 判定点（怎么知道） | 由文档标题、章节和字面合同的自动断言判定。 |
| 保质期（何时过期） | API 合同变化时由维护者同步更新；本 Sprint 不引入自动过期机制。 |
| 死亡告警（停了谁知道） | 冻结测试在 Sprint Tests 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一必需章节或字面合同缺失即验收失败，不降级放行。 |
| 效果确认（已发≠已生效） | Git 树中存在中文文档，冻结测试读取实际文件并验证全部合同。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字段错误 | 测试非零退出并阻塞合并 | 是，修正文档后重跑 | 无降级 |
| 出现代码改动 | E2E 非零退出并阻塞合并 | 是，移除越界改动后重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不暴露新 agent 或输入入口。

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权与白名单构造 POST] → [按 id 查询 GET] → [辨别派发或完整回滚]

### Step 1: 找到两个端点及用途
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 项。

**可观测行为**: 中文说明分别写明 POST 创建并派发 attempt、GET 按 id 查询 attempt-run 状态。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('POST /api/brain/harness/attempt-run')||!s.includes('GET /api/brain/harness/attempt-run/:id')||!s.includes('创建并派发')||!s.includes('按 id 查询'))process.exit(1)"`

**硬阈值**: 两个端点字面及各自用途全部命中；命令 exit 0。

### Step 2: 按鉴权和九项角色白名单构造请求
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2、3 项。

**可观测行为**: 说明 `internalAuthOrLoopback`，宿主/远端携带 Bearer 环境变量，并列出九项冻结角色。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts`

**硬阈值**: 鉴权断言与九角色精确集合断言全部通过；命令 exit 0。

### Step 3: 填写 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 项。

**可观测行为**: `sprint_dir`、`base_repo`、`branch` 明确为必填，`base_sha` 明确可省略且由生产 Brain 自解析。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['sprint_dir','base_repo','branch'])if(!new RegExp(x+'.{0,40}必填','s').test(s))process.exit(1);if(!/base_sha.{0,40}可省略.{0,80}生产 Brain.{0,20}自解析/s.test(s))process.exit(1)"`

**硬阈值**: 三个必填字段和一项省略语义全部命中；命令 exit 0。

### Step 4: 查询并辨别失败回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5、6 项。

**可观测行为**: 说明派发失败自动形成 `run → failed`、`session → closed`、`task → cancelled` 三对象最终状态。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run → failed','session → closed','task → cancelled'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 三条回滚状态同时命中；命令 exit 0。

### Step 5: 防止历史内容或越界改动造成假绿
**来源**: `[AI_ADDED]` — 防止新增目标文档之外的代码或既有文档改动绕过范围验收。

**可观测行为**: 实现提交在 `docs/current/` 只新增目标页，且不触及 `packages/`、`apps/` 或既有文档。

**验证命令**: `bash -c 'BASE=d4ae8c6d2b777f5762c4cd88a8e8d56004c66750; test "$(git diff --name-only "$BASE"...HEAD -- docs/current)" = "docs/current/attempt-run-bridge-guide.md"; ! git diff --name-only "$BASE"...HEAD -- packages apps | grep -q .'`

**硬阈值**: docs/current 交付差异恰为一个目标文件，代码目录差异为零；命令 exit 0。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 Sprint 只记录冻结 PRD 给出的调用合同，不新增或修改设备/agent 调用实现。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本任务纯文档，无真实世界接缝，N/A。）

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=d4ae8c6d2b777f5762c4cd88a8e8d56004c66750
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)' "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts
test "$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current)" = "$DOC"
if git diff --name-only "$BASE_SHA"...HEAD -- packages apps | grep -q .; then echo 'FAIL: 检测到代码改动'; exit 1; fi
echo 'OK: attempt-run 桥接使用说明合同验收通过'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | `说明两个端点用途`、`说明鉴权且不泄露 token`、`列出九项角色白名单`、`说明 payload 必填与 base_sha 省略语义`、`说明派发失败三对象回滚` | 目标文档尚不存在，5 个测试在读取文件时失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把白名单外角色或缺必填字段请求描述为有效。
- 重复提交: 检查同一字段在正文与示例中的必填/可选口径是否一致。
- 中途中断: N/A，静态文档无执行中状态。
- 边界值: 检查 token 只以环境变量出现，未包含疑似真实凭据值。
发现分级: P0/P1（泄露凭据或错误调用合同）阻塞 merge；P2/P3 记录 findings。

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- implementation baseline: `d4ae8c6d2b777f5762c4cd88a8e8d56004c66750`，不得被角色 checkout SHA 替换。
