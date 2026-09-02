# Sprint Contract Draft (Round 1)

task_request_hash: `36b99953756db7bbfbaa29fd6871c56a549f04acbec458352388564d4538b039`

## Response Schema（推导来源: PRD字面）

N/A — 任务仅新增说明文档，不修改或验收 HTTP 响应实现。

## 已知约束

- [packages/brain/src/routes/__tests__/harness-attempt-run.test.js] → `ALLOWED_ROLES` 为冻结九项集合，排除 `commander`、`publisher`。
- [累积FR] 本 line 暂无历史；`journey_id=none`，context-manifest 无可用业务线。
- [Unified Map] `[MAP_NOT_CONFIGURED]`：任务 payload 的 `map_scope` 为空数组，未配置 scope/repo；无 `must_run_assertions`、fact revisions 或 freshness 可纳入。

## Golden Path

独立小路（无父路）

[阅读说明] → [识别端点与鉴权] → [按九项角色及 payload 发起调用] → [查询成功或确认失败回滚终态]

### Step 1: 读者识别两个端点用途与鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 项。

**可观测行为**: 中文文档以独立章节逐字说明 POST 创建派发、GET 按 id 查询，并说明 `internalAuthOrLoopback` 与宿主/远端 Bearer 请求头；不包含真实 token。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 Bearer 鉴权说明完整"
```
**硬阈值**: 该测试 1/1 通过且 exit code=0。

### Step 2: 读者取得封闭角色白名单
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 项；具体枚举逐字取自生产 `ALLOWED_ROLES`。

**可观测行为**: 「角色白名单」章节恰列九项：`canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`；不把其他角色描述为允许值。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰为生产代码定义的九项封闭集合"
```
**硬阈值**: 九项全部出现、列表项数恰为 9、禁用角色不出现，exit code=0。

### Step 3: 读者识别 payload 字段
**来源**: `[FROM_PRD]` — thin PRD 第 3 项。

**可观测行为**: 「payload 字段」章节列 `sprint_dir`、`base_repo`、`branch` 为必填，并明确 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 省略语义完整"
```
**硬阈值**: 三个必填字段和可省略语义逐字命中，exit code=0。

### Step 4: 读者确认派发失败回滚终态
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 项。

**可观测行为**: 「派发失败自动回滚」章节逐字列出 `run → failed`、`session → closed`、`task → cancelled`，并说明可由查询端点观察。

**验证命令**:
```bash
npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三项终态完整"
```
**硬阈值**: 三个状态转换全部出现，exit code=0。

### Step 5: 交付范围保持为单一文档
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转为不可被额外文件绕过的范围 oracle。

**可观测行为**: 相对冻结实现基线仅新增 `docs/current/attempt-run-bridge-guide.md`；sprint 合同产物由 Harness 治理，不计入实现范围。

**验证命令**:
```bash
BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3; git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps | sort | diff -u <(printf '%s\n' 'docs/current/attempt-run-bridge-guide.md') -
```
**硬阈值**: canonical git-diff 范围集合恰等于该文档路径，exit code=0。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本单只记录现有调用契约，不新增或修改设备/agent 请求路径。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单不执行 API、不触碰真机或第三方；文档字面准确性由生产源码与冻结测试交叉约束，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接说明，覆盖 PRD 四类内容。 |
| NFR（做得多好） | 四个独立章节；端点、角色、字段、状态均可逐字机检。 |
| Invariant（永不违反） | 不写真实 token；不改代码；不扩大角色集合。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 生产端点契约变化时由对应 Brain 代码变更同步更新本文档。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同范围 oracle 在文档缺失或漂移时当次 CI 失败。 |
| 失败语义（挂了怎么办） | 任一字面或范围断言失败即阻塞交付，不降级放行。 |
| 效果确认（已发≠已生效） | 文件落地后由四项内容测试与冻结基线范围测试共同确认。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或字面漂移 | 测试非零退出，阻塞交付 | 是 | 无降级 |
| 实现范围出现额外代码文件 | 范围 oracle 非零退出，阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 不对外暴露新 agent 或可写接口。

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 核对示例不得暗示匿名或错误 Bearer 可访问。
- 重复提交: 核对九项列表无重复项、无别名混入。
- 中途中断: N/A，静态文档无运行中状态。
- 边界值: 核对 `base_sha` 缺失明确为合法省略而非请求错误。
发现分级: P0/P1（泄露凭据或错误授权说明）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web（工作区文档机械验收，不启动浏览器）

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3
npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts
git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps | sort | diff -u <(printf '%s\n' 'docs/current/attempt-run-bridge-guide.md') -
git diff --check "$BASE_SHA"...HEAD
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts` | `两个端点用途与 Bearer 鉴权说明完整`；`角色白名单恰为生产代码定义的九项封闭集合`；`payload 必填字段与 base_sha 省略语义完整`；`派发失败回滚三项终态完整` | 目标文档尚不存在，`readFileSync` 抛 ENOENT，4 tests failed |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 实现基线固定为 `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`，不得以角色 checkout SHA 替换。
