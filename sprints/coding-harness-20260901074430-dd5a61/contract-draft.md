# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增 Markdown 文档，无 HTTP 响应或数据库变更；文档描述既有端点，不改变其 schema。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- [tests/gp/f1/step3-attempt-run-endpoint.test.js] → POST 创建、GET 查询、派发回滚与鉴权均已有生产实现回归测试，本 Sprint 不修改这些行为。
- [累积FR] 本 line 暂无历史。
- [MAP_NOT_CONFIGURED] task payload 未提供可用的 map_scope/map_repo；无 Unified Map 回归断言。
- context-manifest: N/A（journey_id=none）。

## 八要素需求规范

| 要素 | 本次答案 |
|------|----------|
| FR（做什么） | 新增 `docs/current/attempt-run-bridge-guide.md`，准确说明创建、查询、鉴权、九项角色、payload 与派发失败回滚。 |
| NFR（做得多好） | 中文单页；九项角色不增不减；读者无需查源码即可区分四类信息。 |
| Invariant（永不违反） | 不修改代码；不硬编码 token 值；不把远端误写为免鉴权；不把 `base_sha` 写成必填。 |
| 判定点（怎么知道） | N/A；文档内容均由既有源码常量、路由和回滚 SQL 精确映射。 |
| 保质期（何时过期） | 角色、鉴权、payload 或回滚实现变化时由修改对应实现的 PR 同步更新该页。 |
| 死亡告警（停了谁知道） | Sprint 冻结测试与 E2E 文档断言在 CI 中失败并阻塞合并。 |
| 失败语义（挂了怎么办） | 任一必备章节、角色或状态缺失即验收失败，不降级放行。 |
| 效果确认（已发≠已生效） | 从冻结基线比较变更集合，并对文档标题、中文、精确角色集合及四类内容执行断言。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 文档缺节或事实不符 | 测试非零退出并阻塞合并 | 是，修正文档后可重跑 | 无降级 |
| 变更包含代码或额外文件 | E2E 变更范围断言失败 | 是，移除越界变更后可重跑 | 无降级 |

### 输入对抗面

N/A — 本任务不新增或暴露 agent/API 输入面。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[进入中文说明页] → [识别创建与查询] → [按鉴权和 payload 发起请求] → [核对角色与失败收口]

### Step 1: 读者进入唯一中文说明页
**来源**: `[FROM_PRD]` — PRD「背景」「范围限定」要求在 `docs/current/` 新增一页中文权威入口。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在，标题为《attempt-run 桥接使用说明》且含中文正文。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; test -f "$DOC" && grep -q '^# attempt-run 桥接使用说明' "$DOC" && grep -qP '[\x{4e00}-\x{9fff}]' "$DOC"
```

**硬阈值**: 文件恰位于指定路径，标题与中文检查均返回 0；阈值由上方命令直接断言。

### Step 2: 读者区分创建、查询与鉴权
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1、2 项及边界情况。

**可观测行为**: 文档分别解释 `POST /api/brain/harness/attempt-run` 创建用途与 `GET /api/brain/harness/attempt-run/:id` 查询用途，并明确两者使用 `internalAuthOrLoopback`，宿主/远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; grep -q 'POST /api/brain/harness/attempt-run' "$DOC" && grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC" && grep -q 'internalAuthOrLoopback' "$DOC" && grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
```

**硬阈值**: 两个方法与路径、鉴权中间件、远端 Bearer 约束四项全部精确出现；阈值由上方命令直接断言。

### Step 3: 读者获得精确角色白名单与 payload 规则
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3、4 项；角色拼写以 `ALLOWED_ROLES` 为权威来源。

**可观测行为**: 角色白名单以九个独立条目列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`；payload 明确必填 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略且由生产 Brain 自解析。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; EXPECTED='canary planner proposer reviewer generator generator-fix evaluator evaluator-evidence-repair judge'; ACTUAL=$(awk '/^## .*角色白名单/{on=1;next} on&&/^## /{on=0} on&&/^- `[^`]+`/{gsub(/^- `|`.*$/,"");print}' "$DOC" | paste -sd' ' -); test "$ACTUAL" = "$EXPECTED" && grep -Eq 'sprint_dir.*(必填|required)' "$DOC" && grep -Eq 'base_repo.*(必填|required)' "$DOC" && grep -Eq 'branch.*(必填|required)' "$DOC" && grep -Eq 'base_sha.*(可省略|非必填)' "$DOC" && grep -Eq '生产 Brain.*(自解析|解析)' "$DOC"
```

**硬阈值**: 角色集合及顺序与生产 `ALLOWED_ROLES` 完全一致且恰为九项；三个必填字段和 `base_sha` 省略语义全部命中；阈值由上方命令直接断言。

### Step 4: 读者确认派发失败的自动回滚
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5、6 项与边界情况。

**可观测行为**: 文档在独立失败回滚章节同时说明 `run→failed`、`session→closed`、`task→cancelled`，不遗漏任何关联对象。

**验证命令**:
```bash
DOC=docs/current/attempt-run-bridge-guide.md; grep -q '^## .*派发失败.*回滚' "$DOC" && grep -Eq 'run.*(→|->).*failed' "$DOC" && grep -Eq 'session.*(→|->).*closed' "$DOC" && grep -Eq 'task.*(→|->).*cancelled' "$DOC"
```

**硬阈值**: 独立回滚章节和三个终态断言全部返回 0；阈值由上方命令直接断言。

## 真实调用方请求 shape

N/A — 本 Sprint 不新增或改动调用方请求；文档只按 PRD 描述既有端点。必须记录的请求规则为：宿主/远端使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；POST body 的 `payload` 包含 `sprint_dir`、`base_repo`、`branch`，`base_sha` 可省略。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 接缝清单

（本单不改真实系统接缝；验收对象为 checkout 中的 Markdown 内容，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
BASE_SHA=de47c2d8b164a09ea5470eb9948ad6e8b2cf6ba1
SPRINT_DIR=sprints/coding-harness-20260901074430-dd5a61
test -f "$DOC"
grep -q '^# attempt-run 桥接使用说明' "$DOC"
grep -qP '[\x{4e00}-\x{9fff}]' "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
EXPECTED='canary planner proposer reviewer generator generator-fix evaluator evaluator-evidence-repair judge'
ACTUAL=$(awk '/^## .*角色白名单/{on=1;next} on&&/^## /{on=0} on&&/^- `[^`]+`/{gsub(/^- `|`.*$/,"");print}' "$DOC" | paste -sd' ' -)
test "$ACTUAL" = "$EXPECTED"
grep -Eq 'sprint_dir.*(必填|required)' "$DOC"
grep -Eq 'base_repo.*(必填|required)' "$DOC"
grep -Eq 'branch.*(必填|required)' "$DOC"
grep -Eq 'base_sha.*(可省略|非必填)' "$DOC"
grep -Eq '生产 Brain.*(自解析|解析)' "$DOC"
grep -q '^## .*派发失败.*回滚' "$DOC"
grep -Eq 'run.*(→|->).*failed' "$DOC"
grep -Eq 'session.*(→|->).*closed' "$DOC"
grep -Eq 'task.*(→|->).*cancelled' "$DOC"
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD | awk -v prefix="${SPRINT_DIR}/" 'index($0,prefix)!=1')
test "$CHANGED" = "$DOC"
echo 'attempt-run 桥接说明 E2E 验收通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否误示例远端无 Bearer、或将 token 字面值写入文档。
- 重复提交: 检查九项角色是否重复、别名或顺序漂移。
- 中途中断: N/A，静态文档无异步过程。
- 边界值: 检查 `base_sha` 是否被误列入必填字段，以及三个回滚终态是否同时存在。
发现分级: P0/P1（凭据泄露、错误鉴权或错误回滚语义）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明完整性 | `sprints/coding-harness-20260901074430-dd5a61/tests/attempt-run-bridge-guide.test.ts` | `创建查询与远端鉴权说明完整`、`九项角色白名单精确且不增不减`、`payload 必填与 base_sha 省略语义完整`、`派发失败三对象回滚终态完整` | 文档尚不存在，至少 4 个测试失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 本合同只约束 Generator 新增 `docs/current/attempt-run-bridge-guide.md`；Sprint 合同与冻结测试属于 Harness 治理产物，不计入产品实现范围。
