# Sprint Contract Draft（Round 1）

## Notes

- 权威实现基线：`d32b864de5adf8d3083c91f31ed3f5f7f58be985`；不得用角色检出的其他 SHA 替换。
- `[MAP_NOT_CONFIGURED]`：task payload 未提供 `map_scope`/`map_repo`，无 Unified Map 回归断言可引入。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束

- `[回归测试] packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单恰好九项、路由同时包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- `[生产实现] packages/brain/src/routes/harness-attempt-run.js` → 九项角色名、鉴权中间件、派发失败回滚状态是文档事实来源。
- `[累积FR]` 本 line 暂无历史。
- `context-manifest: unavailable`（PRD 的 journey_id 为 `none`，无可查询业务线）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增中文说明，覆盖两个端点、鉴权、九项封闭角色、payload 字段与失败回滚。 |
| NFR（做得多好） | 内容与当前生产 Brain 实现一致；角色清单可机械确认恰好九项。 |
| Invariant（永不违反） | 仅新增目标文档，不改代码、CI、接口、鉴权、角色或状态行为。 |
| 判定点（怎么知道） | 无外部真实状态推断；以冻结基线中的路由源码为事实源。 |
| 保质期（何时过期） | 角色、鉴权、payload 或回滚实现变化时由对应代码变更维护者同步更新。 |
| 死亡告警（停了谁知道） | 文档验收测试和范围 oracle 在 CI 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一章节、精确枚举、正负 oracle 或范围 oracle失败即阻塞交付。 |
| 效果确认（已发≠已生效） | 从冻结基线到候选 HEAD 的 diff 中确认唯一实现交付物，并逐项解析正文。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或事实不精确 | 测试非零退出，阻塞合并 | 是 | 无降级，不接受示例集合或含混表述 |
| 范围出现额外实现文件 | 范围 oracle 非零退出，阻塞合并 | 是 | 删除越界变更后重新验证 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或输入处理面。

## 判定点登记表

（本任务无接缝判定点，N/A）

## 失败语义

- 文档缺失、中文正文缺失、清单多项/少项、出现禁止角色、把远端写成免鉴权、把 `base_sha` 写成必填，均为确定性 FAIL。
- 范围 oracle 发现目标文档之外的实现变更时确定性 FAIL。

## 真实调用方请求 shape

本 sprint 不改变调用 shape；文档必须按生产路由说明：两个端点均经 `internalAuthOrLoopback`；宿主/远端请求使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。POST body 的 `payload` 必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略并由生产 Brain 解析；不得将 loopback 免 token 描述成宿主/远端免鉴权。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A）

## 接缝清单

（本单只对冻结源码事实进行文档化，无需执行真实网络或数据库接缝，N/A）

## Golden Path

独立小路（无父路）

[打开说明] → [确认鉴权与角色] → [准备 POST payload] → [POST 派发并 GET 查询] → [识别派发失败回滚]

### Step 1：读者找到唯一说明页并识别两个端点用途
**来源**: `[FROM_PRD]` — `Golden Path（核心场景）` 第 1 项。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 是中文说明，分别解释 POST 异步派发和 GET 按 attempt id 轮询结构化结果。

**验证命令**: `node sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` 对应 Vitest 用例执行。

**硬阈值**: 目标文件存在；两个端点字面值和各自用途均出现。验证命令见 E2E 第 1、2 段。

### Step 2：读者按正确鉴权和封闭角色集合准备请求
**来源**: `[FROM_PRD]` — `Golden Path（核心场景）` 第 2、3 项。

**可观测行为**: 文档区分 loopback 与宿主/远端；后者明确携带 Bearer token，并以独立列表精确列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`。

**验证命令**: E2E 用 `awk` 只提取角色章节，确认九行精确等于权威集合，并反向拒绝 `commander`、`publisher`。

**硬阈值**: 恰好九项，不多不少；宿主/远端不得被描述为免鉴权。验证命令见 E2E 第 3、4 段。

### Step 3：读者构造 payload 且不误填 base_sha
**来源**: `[FROM_PRD]` — `Golden Path（核心场景）` 第 4 项。

**可观测行为**: 文档将 `sprint_dir`、`base_repo`、`branch` 标为必填，将 `base_sha` 标为可省略并说明由生产 Brain 自解析。

**验证命令**: E2E 提取 payload 章节，正向验证三个必填字段，负向拒绝 `base_sha` 必填措辞。

**硬阈值**: 三个必填字段全部存在；`base_sha` 只能是可省略语义。验证命令见 E2E 第 5 段。

### Step 4：读者识别派发失败后的完整回滚
**来源**: `[FROM_PRD]` — `Golden Path（核心场景）` 第 5 项。

**可观测行为**: 文档同节明确 `run → failed`、`session → closed`、`task → cancelled`，并说明这是自动回滚。

**验证命令**: E2E 提取回滚章节并逐项精确匹配三个对象的终态。

**硬阈值**: 三个状态对全部出现且标为自动行为。验证命令见 E2E 第 6 段。

### Step 5：交付范围保持为唯一说明页
**来源**: `[AI_ADDED]` — 将 PRD 的“不改任何代码、不新增其他文档”转成不可绕过的冻结基线 diff oracle。

**可观测行为**: 排除本 sprint 的合同治理产物后，相对权威实现基线只有 `docs/current/attempt-run-bridge-guide.md` 一个实现交付文件。

**验证命令**: E2E 使用写死的 `BASE_SHA=d32b864de5adf8d3083c91f31ed3f5f7f58be985` 与 canonical `git diff --name-only "$BASE_SHA"...HEAD`，过滤本 sprint 冻结合同目录后精确比对。

**硬阈值**: 实现文件集合严格等于目标文档；零代码文件。验证命令见 E2E 最后一段。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（仅使用仓库检出环境执行文档 oracle，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=d32b864de5adf8d3083c91f31ed3f5f7f58be985
SPRINT_DIR=sprints/coding-harness-20260902140724-6b5mog
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
grep -qE '[一-龥]' "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -Eq 'POST.*(异步派发|创建)' "$DOC"
grep -Eq 'GET.*(轮询|查询)' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
AUTH=$(awk '/^## 鉴权/{on=1;next}/^## /{on=0}on' "$DOC")
printf '%s' "$AUTH" | grep -Eq '宿主|远端'
if printf '%s' "$AUTH" | grep -Eq '(宿主|远端).*(免鉴权|无需.*token|不需要.*token)'; then exit 1; fi
ROLES=$(awk '/^## 角色白名单/{on=1;next}/^## /{on=0}on' "$DOC" | sed -nE 's/^- `([^`]+)`.*/\1/p' | sort)
EXPECTED=$(printf '%s\n' canary evaluator evaluator-evidence-repair generator generator-fix judge planner proposer reviewer | sort)
[ "$(printf '%s\n' "$ROLES" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 9 ]
[ "$ROLES" = "$EXPECTED" ]
if grep -Eq '^- `(commander|publisher)`' "$DOC"; then exit 1; fi
PAYLOAD=$(awk '/^## Payload/{on=1;next}/^## /{on=0}on' "$DOC")
for FIELD in sprint_dir base_repo branch; do printf '%s' "$PAYLOAD" | grep -Eq "${FIELD}.*必填|必填.*${FIELD}"; done
printf '%s' "$PAYLOAD" | grep -q 'base_sha'
printf '%s' "$PAYLOAD" | grep -Eq 'base_sha.*(可省略|非必填)|(可省略|非必填).*base_sha'
printf '%s' "$PAYLOAD" | grep -q '生产 Brain'
if printf '%s' "$PAYLOAD" | grep -Eq 'base_sha.*必填|必填.*base_sha'; then exit 1; fi
ROLLBACK=$(awk '/^## 派发失败自动回滚/{on=1;next}/^## /{on=0}on' "$DOC")
printf '%s' "$ROLLBACK" | grep -Eq 'run.*(→|->).*failed'
printf '%s' "$ROLLBACK" | grep -Eq 'session.*(→|->).*closed'
printf '%s' "$ROLLBACK" | grep -Eq 'task.*(→|->).*cancelled'
IMPL_DIFF=$(git diff --name-only "$BASE_SHA"...HEAD | awk -v sprint="$SPRINT_DIR/" 'index($0,sprint)!=1')
[ "$IMPL_DIFF" = "$DOC" ]
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把未知角色描述为可接受。
- 重复提交: N/A，静态文档无提交动作。
- 中途中断: N/A，静态文档无异步流程。
- 边界值: 检查 `base_sha` 省略语义是否被“建议填写”等措辞弱化。
发现分级: P0/P1（错误鉴权或开放角色集合）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | `包含两个端点及各自用途`、`角色白名单恰好是九项封闭集合`、`payload 必填字段且 base_sha 可省略`、`派发失败自动回滚三个对象`、`实现范围只有目标说明文档` | 目标文档尚不存在，至少 5 个用例失败 |

