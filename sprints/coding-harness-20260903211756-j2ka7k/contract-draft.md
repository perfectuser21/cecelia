# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD 字面）

N/A — 本次只新增使用说明，不修改或定义 HTTP 响应。

## 技术事实与证据来源

- 权威实现：`packages/brain/src/routes/harness-attempt-run.js`；现场确认两个端点、`internalAuthOrLoopback`、九项 `ALLOWED_ROLES`、payload 校验和 rollback SQL。
- API/DB/test registry 均可访问；本合同不新增 API 或 DB schema，测试沿用 Vitest 的 `describe/it/expect`。
- Unified Map: `[MAP_NOT_CONFIGURED]`（任务 payload 的 `map_scope` 不是可用 scope 字符串，故没有 `must_run_assertions`，不回退到领域硬编码）。
- `fact_revisions` / `freshness`: Map 未配置，N/A。
- 实现基线（权威）：`a3639b56c04e7ced8fa1c1d623efa51ea25666a7`；PRD 中旧的 `5a9c...` 不覆盖 task bundle 的 implementation baseline。
- context-manifest: journey_id 为 `none`，无可查询业务 line；累积 FR 为“暂无历史”。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭为九项且不包含 commander/publisher；Router 同时注册 POST 与 GET 路径。
- `[累积FR]` 本 line 暂无历史。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 仅新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容与当前生产实现逐项一致，封闭枚举现场计数，机器断言能指出缺项。 |
| Invariant（永不违反） | 不改代码；不提交凭据；实现基线固定为 `a3639b56c04e7ced8fa1c1d623efa51ea25666a7`。 |
| 判定点（怎么知道） | 见下方登记表；全部由源码封闭集合与文档文本确定。 |
| 保质期（何时过期） | 当端点、鉴权、角色或 payload 实现变化时，由对应代码变更者同步更新文档与冻结测试。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同测试在 CI 中失败，PR 作者在当次 CI 内获知。 |
| 失败语义（挂了怎么办） | 任一枚举、配对、范围断言失败即阻塞合并，不降级放行。 |
| 效果确认（已发≠已生效） | 对文档和生产 `ALLOWED_ROLES` 做集合相等，并从固定基线审计真实 git diff。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、错枚举或越界改动 | 测试非零退出并阻塞合并 | 是 | 无降级 |
| 权威源码集合变化 | 集合相等断言失败，要求同步文档 | 是 | 无降级 |

### 输入对抗面

N/A — 本次不新增或修改对外 agent/API 输入面。

## 禁 mock 边清单

（本单纯文档改动，不改调度、状态机、模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本次不修改真实调用方或请求协议；文档仅转录生产端点既有事实。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单纯文档，无真实世界接缝，N/A。）

## Golden Path

独立小路（无父路）

[阅读说明] → [按环境鉴权并 POST 派发] → [以 attempt id GET 查询] → [失败时识别三个回滚终态]

### Step 1: 找到中文说明及四个主题
**来源**: `[FROM_PRD]` — thin_prd“新增一页《attempt-run 桥接使用说明》”及四项内容。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 有中文标题与四个独立主题。

**验证命令**: `npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t '中文标题与四个主题章节完整'`

**硬阈值**: 正向命中中文标题和四主题，负向拒绝英文标题或合并结构；exit code = 0。

### Step 2: 按环境鉴权并理解两个端点
**来源**: `[FROM_PRD]` — Golden Path 第 1、2 项与边界情况。

**可观测行为**: 读者能区分 POST 派发和 GET 按 attempt-run id 查询，并知道宿主/远端必须携带 Bearer token 占位符。

**验证命令**: `npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t 'POST 与 GET 用途|鉴权说明'`

**硬阈值**: 两个正向用途、鉴权方式均命中；错误 id、匿名远端和疑似真实 token 均不命中；exit code = 0。

### Step 3: 按封闭角色和 payload 契约派发
**来源**: `[FROM_PRD]` — Golden Path 第 3、4 项。

**可观测行为**: 文档现场列举九个角色且与 `ALLOWED_ROLES` 集合相等；必填字段恰为 `sprint_dir/base_repo/branch`，`base_sha` 明确可省略并由生产 Brain 自解析。

**验证命令**: `npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t '角色白名单现场列举|payload 现场列举'`

**硬阈值**: 角色 9 项无重复、必填字段 3 项；拒绝角色别名/重复和 `base_sha` 必填说法；exit code = 0。

### Step 4: 识别派发失败的完整回滚
**来源**: `[FROM_PRD]` — Golden Path 第 5 项。

**可观测行为**: 文档现场列举 `run → failed`、`session → closed`、`task → cancelled`。

**验证命令**: `npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t '派发失败现场列举'`

**硬阈值**: 三项且仅三项、顺序与状态精确；遗漏或错态失败；exit code = 0。

### Step 5: 确认交付范围和断言配对
**来源**: `[AI_ADDED]` — 将“不改任何代码”和用户要求的正负 oracle 两两配对转成不可假绿的机械闸。

**可观测行为**: 固定实现基线后的产品差异只有目标文档；八组正负 oracle 共十六项且配对闭合。

**验证命令**: `npx vitest run sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts -t '唯一产品改动|正负 oracle 成对'`

**硬阈值**: 产品 diff 精确等于一个目标文档；8 对 = 16 项；任一越界或缺对失败；exit code = 0。

## 断言配对自洽推演

现场枚举共 8 对、16 项 oracle：中文结构、端点用途、鉴权安全、九角色封闭集合、三必填字段、三回滚终态、唯一产品范围、配对计数；每对均由一个正向“必须出现/相等”与一个负向“错误形式不得出现/不得越界”构成。逐对推演结论：正向缺失必失败，负向样例混入也必失败，两侧不互相蕴含且没有静默放行分支；总数封闭，自洽。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例把 GET `:id` 替换为 task/session id 时测试是否失败。
- 重复提交: 重复一个角色条目时九项无重复断言是否失败。
- 中途中断: 删除任一主题章节时测试是否明确报缺节。
- 边界值: 把 `base_sha` 改成必填或漏掉一个回滚终态时测试是否失败。
发现分级: P0/P1（凭据泄漏/契约误导）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA='a3639b56c04e7ced8fa1c1d623efa51ea25666a7'
TEST_FILE='sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts'
test "$(git merge-base "$BASE_SHA" HEAD)" = "$BASE_SHA"
npx vitest run "$TEST_FILE" --reporter=verbose
CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD -- . ':(exclude)sprints/coding-harness-20260903211756-j2ka7k/**')
test "$CHANGED" = 'docs/current/attempt-run-bridge-guide.md'
echo 'OK: 8 对 16 项断言全部通过，产品范围仅含目标文档'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 桥接说明完整合同 | `sprints/coding-harness-20260903211756-j2ka7k/tests/attempt-run-bridge-guide.test.ts` | `中文标题与四个主题章节完整`；`POST 与 GET 用途`；`鉴权说明`；`角色白名单现场列举`；`payload 现场列举`；`派发失败现场列举`；`唯一产品改动`；`正负 oracle 成对` | 目标文档尚不存在，至少前七项因 `ENOENT` 或产品 diff 不匹配而失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` present)
- documentation-only：Generator 唯一产品文件为 `docs/current/attempt-run-bridge-guide.md`，不得修改代码、测试代码、API、schema、白名单或其他文档。
