# Sprint Contract Draft (Round 1)

task_request_hash: 541dc1728c1cd6aed31701812cd4e8bdc2a35773bcaf39af521e12d23c1c7b7d

## 范围与实现基线

- 权威实现基线：`2721277993f33d00b8a4c2d94fdec5b1ac4f7f32`；不得用角色工作区 SHA 替换。
- 唯一产品产物：`docs/current/attempt-run-bridge-guide.md`，中文 Markdown。
- 不修改产品代码、数据库、配置或其他文档；不引用或要求生成任务计划文件。
- `[MAP_NOT_CONFIGURED]`：未提供 map_scope/map_repo，无 must_run_assertions、fact_revisions 或 freshness 可继承。
- gp-anchor: skipped (product-map.json not found)

## 已知约束

- [PRD 铁律] 保持服务端签发分支；沿用冻结实现基线；凭据不硬编码、不入库、不入日志；端点鉴权说明不得弱化；本任务不执行生产接缝。
- [累积 FR] 本 line 暂无历史。
- [回归测试] `packages/brain/src/middleware/internal-auth.test.js` 覆盖 loopback 与远端鉴权边界；生产角色与回滚语义以 `packages/brain/src/routes/harness-attempt-run.js` 为事实来源。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)

## Response Schema（推导来源: PRD字面）

N/A — 任务只新增说明文档，不新增或修改 HTTP 响应。

## 恰好 N 清单（先列清单，后推导断言）

1. 端点恰好 2 个：创建用 `POST /api/brain/harness/attempt-run`；查询用 `GET /api/brain/harness/attempt-run/:id`。
2. 鉴权规则恰好 2 类调用位置：本机 loopback 可由 `internalAuthOrLoopback` 放行；宿主/远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 角色白名单恰好 9 项：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。
4. payload 必填字段恰好 3 项：`sprint_dir`、`base_repo`、`branch`；另有 1 项可省略字段 `base_sha`，省略时由生产 Brain 自解析。
5. 派发失败回滚终态恰好 3 对：`run→failed`、`session→closed`、`task→cancelled`。
6. 产品变更文件恰好 1 个：`docs/current/attempt-run-bridge-guide.md`。

## Golden Path

独立小路（无父路）

[阅读说明] → [识别端点与鉴权] → [选择九项角色之一并填写 payload] → [查询结果或判断回滚终态]

### Step 1: 找到中文桥接说明与两个端点用途
**来源**: `[FROM_PRD]` — thin_prd 第 1 项及 Golden Path 第 1 步。
**可观测行为**: 读者能区分 POST 创建 attempt 与 GET 按 id 查询结果。
**正向验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','创建','查询'])if(!s.includes(x))process.exit(1)"`
**负向验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(/POST[^\n]*(查询)|GET[^\n]*(创建)/.test(s))process.exit(1)"`
**硬阈值**: 2 个端点逐字出现且用途不互换；以上正负命令均 exit 0。

### Step 2: 按调用位置应用鉴权
**来源**: `[FROM_PRD]` — thin_prd 第 1 项及边界情况。
**可观测行为**: 读者不会把 loopback 便利误解为宿主/远端免鉴权。
**正向验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('internalAuthOrLoopback')||!s.includes('Bearer CECELIA_INTERNAL_TOKEN')||!s.includes('宿主')||!s.includes('远端'))process.exit(1)"`
**负向验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(/(宿主|远端)[^\n]*(免鉴权|无需鉴权|不需要.*Bearer)/.test(s))process.exit(1)"`
**硬阈值**: 鉴权名与 Bearer 写法逐字出现，远端免鉴权误述为 0；以上正负命令均 exit 0。

### Step 3: 选择角色并构造 payload
**来源**: `[FROM_PRD]` — thin_prd 第 2、3 项。
**可观测行为**: 读者看到无省略的 9 项角色，知道 3 个必填字段以及 `base_sha` 的省略语义。
**正向验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts`
**负向验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(/等角色|`base_sha`[^\n]*必填/.test(s))process.exit(1)"`
**硬阈值**: 角色数 = 9、payload 必填数 = 3、可省略 base SHA 数 = 1；以上正负命令均 exit 0。

### Step 4: 判断派发失败后的资源终态
**来源**: `[FROM_PRD]` — thin_prd 第 4 项。
**可观测行为**: 读者能逐资源确认自动回滚结果。
**正向验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run→failed','session→closed','task→cancelled'])if(!s.includes(x))process.exit(1)"`
**负向验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(/run→(done|completed)|session→active|task→(queued|in_progress)/.test(s))process.exit(1)"`
**硬阈值**: 3 对回滚终态全部逐字出现且不存在相反终态；以上正负命令均 exit 0。

### Step 5: 将交付范围锁定为一页文档
**来源**: `[AI_ADDED]` — 把 PRD “不改任何代码”转成不可由额外文件造假的范围 oracle。
**可观测行为**: 相对冻结实现基线，产品交付只新增指定文档。
**正向验证命令**: `BASE_SHA=2721277993f33d00b8a4c2d94fdec5b1ac4f7f32; git diff --name-only "$BASE_SHA" HEAD -- docs/current/ | grep -Fx 'docs/current/attempt-run-bridge-guide.md'`
**负向验证命令**: `BASE_SHA=2721277993f33d00b8a4c2d94fdec5b1ac4f7f32; test "$(git diff --name-only "$BASE_SHA" HEAD -- . ':(exclude)sprints/coding-harness-20260904093148-3cc0bn/**' | sort)" = 'docs/current/attempt-run-bridge-guide.md'`
**硬阈值**: 排除 Sprint 合同产物后 changed product paths 恰好 1 个且等于目标文档；以上正负命令均 exit 0。

## 断言自洽声明

上述 5 对 oracle 按“存在/正确”与“缺失/误述/越界”逐对推演：端点正向要求 2 个端点及用途，负向拒绝用途互换；鉴权正向要求中间件名与远端 Bearer，负向拒绝远端免鉴权；角色/payload 正向精确计数，负向拒绝省略词及把 `base_sha` 写成必填；回滚正向要求 3 对终态，负向拒绝相反终态；范围正向确认目标文档，负向以冻结 `BASE_SHA` 确认无额外产品路径。每对断言可以同时为真，且任一 PRD 义务缺失、写反或范围扩大时至少一个命令非零；断言不依赖被测文档自报“通过”。

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 接缝清单

（本单仅校验静态中文说明，不执行生产端点或真实调用方接缝，N/A。）

## 真实调用方请求 shape

文档说明对象的生产调用 shape 为：远端请求使用 `Authorization: Bearer CECELIA_INTERNAL_TOKEN`；POST body 顶层选择 `role`，并在 `payload` 内传 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略。合同不发真实请求、不新增调用 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免；文档任务不要求实际派发，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖 PRD 四类内容。 |
| NFR（做得多好） | 清单无省略，所有“恰好 N”均可机器计数。 |
| Invariant（永不违反） | 只改目标文档；不泄露 token 值；冻结实现基线不变。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 角色、字段、鉴权或回滚生产合同变化时由对应代码变更同步更新本文。 |
| 死亡告警（停了谁知道） | Sprint 测试和 E2E 内容/范围断言失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一内容或范围断言非零即拦截，不降级放行。 |
| 效果确认（已发≠已生效） | 以仓库正文内容及相对冻结基线的 git diff 双重确认。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺项、误述或数量不精确 | 测试非零并拦截合并 | 是，修正文档后重跑 | 无降级 |
| 超出允许路径 | 范围 oracle 非零并拦截合并 | 是，移除越界变更后重跑 | 无降级 |

### 输入对抗面

N/A — 不对外暴露 agent 或新增可写接口。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=2721277993f33d00b8a4c2d94fdec5b1ac4f7f32
SPRINT_DIR=sprints/coding-harness-20260904093148-3cc0bn
DOC=docs/current/attempt-run-bridge-guide.md
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts"
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');if(!/[一-龥]/.test(s))process.exit(1);if(/等角色|宿主[^\n]*(免鉴权|无需鉴权)|远端[^\n]*(免鉴权|无需鉴权)|`base_sha`[^\n]*必填/.test(s))process.exit(1)" "$DOC"
test "$(git diff --name-only "$BASE_SHA" HEAD -- . ":(exclude)$SPRINT_DIR/**" | sort)" = "$DOC"
echo 'OK: attempt-run 桥接说明内容、负向语义与范围均通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查正文是否把 `base_sha` 或其他字段误列为必填。
- 重复提交: 搜索角色重复项或同一端点用途互相矛盾。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 检查角色恰好 9 项、必填字段恰好 3 项、回滚终态恰好 3 对。
发现分级: P0/P1（凭据泄露、远端免鉴权误述）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 桥接说明完整性 | `sprints/coding-harness-20260904093148-3cc0bn/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途与鉴权说明完整`；`九项角色白名单恰好逐项列出`；`payload 三项必填且 base_sha 明确可省略并由生产 Brain 自解析`；`派发失败回滚三类资源终态完整` | 目标文档尚不存在，4 个 it 块均因 ENOENT 失败 |
