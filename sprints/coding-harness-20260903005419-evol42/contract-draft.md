# Sprint Contract Draft (Round 1)

## Notes

- implementation baseline: `6230da4a13fad9e43d6316b70914b5b69033ef37`（冻结范围 oracle 的唯一基线；不以 role checkout 替换）
- `[MAP_NOT_CONFIGURED]`：task payload 未配置可用的 map_scope/map_repo，must_run_assertions 为空。
- registry 未提供与本纯文档任务相关的新模式；生产事实取自 `packages/brain/src/routes/harness-attempt-run.js`。
- context-manifest: unavailable（journey_id 为 none）。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本任务不新增或修改 HTTP 响应，只记录既有端点的使用合同。

## 已知约束

- `[回归测试] packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单长度为九且不含 commander/publisher；Router 同时挂载 POST 与 GET 路径。
- `[累积FR]` 本 line 暂无历史。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 内容可由 Vitest 机械解析；封闭枚举恰好九项；不得包含真实 token。 |
| Invariant（永不违反） | 不改代码；不泄露凭据；不把非 loopback 调用描述成免鉴权。 |
| 判定点（怎么知道） | 文档章节与冻结测试的集合相等、正负 oracle 共同判定。 |
| 保质期（何时过期） | 生产端点合同变化时由对应代码变更同步更新本文档与冻结测试。 |
| 死亡告警（停了谁知道） | CI 的 Sprint Tests 在文档缺失或漂移时立即失败并通知 PR 作者。 |
| 失败语义（挂了怎么办） | 文档验收 fail-closed；任一必需内容、负向说明或范围约束缺失即拒绝交付。 |
| 效果确认（已发≠已生效） | 从文档构造合法请求，并能由查询说明解释三资源终态；本 Sprint 不真实派发。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节、枚举漂移或出现范围外产品文件 | 冻结测试非零退出，阻塞交付 | 是，只读检查 | 无降级，修正文档后重跑 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入处理面。

## 判定点登记表

（本任务无接缝判定点，N/A）

## 真实调用方请求 shape

文档示例必须使用 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`；POST body 顶层含 `role`，`payload` 内逐字使用 `sprint_dir`、`base_repo`、`branch`，可选 `base_sha`。本 Sprint 只记录生产 shape，不触发请求。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、模块接缝或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免；按 PRD 明确不验证真实派发副作用，N/A。）

## Golden Path

独立小路（无父路）

[阅读说明] → [构造合法 POST] → [按 attempt id 查询] → [解释成功或完整失败终态]

### Step 1: 找到两个端点及其用途
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 中文文档分别解释创建/派发与按标识查询。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '两个端点用途与鉴权正反向 oracle 完整'`

**硬阈值**: 两个完整路径各出现且测试 exit 0；缺任一路径时测试必须非零。

### Step 2: 按调用位置正确鉴权
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项与「边界情况」。

**可观测行为**: 读者知道两端点采用 `internalAuthOrLoopback`，宿主/远端携带 Bearer 占位 token；缺失、无效凭据不会成功。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '两个端点用途与鉴权正反向 oracle 完整'`

**硬阈值**: 正向鉴权词与负向拒绝语义同时命中，且无疑似真实 token。

### Step 3: 从封闭角色集合选择角色
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项。

**可观测行为**: 独立清单恰好列出生产九角色，白名单外角色明确被拒。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '角色白名单是逐项列名的封闭九项集合且含越界拒绝'`

**硬阈值**: 集合与九个字面角色完全相等，数量恰好 9；publisher 等越界值不得进入集合。

### Step 4: 构造 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项与「边界情况」。

**可观测行为**: 三个字段标记必填；`base_sha` 可省略并由生产 Brain 自解析；缺必填字段不会成功。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t 'payload 必填与可选语义均有对应负向 oracle'`

**硬阈值**: 三个必填字段逐字命中，base_sha 的可选语义及负向 oracle 同时命中。

### Step 5: 查询并解释失败回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5-6 项。

**可观测行为**: 失败不是半成功；GET 结果应按三个资源的完整终态解释。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '派发失败回滚封闭覆盖三个资源且否定半成功'`

**硬阈值**: 回滚集合恰好是 run→failed、session→closed、task→cancelled，少项或多项均失败。

### Step 6: 限定唯一产品产物
**来源**: `[AI_ADDED]` — 将 PRD「不改任何代码」转为不可被口头声明绕过的冻结基线差异断言。

**可观测行为**: 除 Sprint 合同产物外，差异恰好只有目标中文文档。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t '范围 oracle 只允许唯一 docs 产品文件且冻结基线不漂移'`

**硬阈值**: 以 `6230da4a13fad9e43d6316b70914b5b69033ef37` 为 base 的产品差异集合完全等于 `docs/current/attempt-run-桥接使用说明.md`。

## 接缝清单

本 Sprint 不执行真实端点或 DB 写入；PRD 明确排除真实派发副作用，因此无接缝断言。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把白名单外角色或缺必填字段描述为可接受。
- 重复提交: N/A，纯文档交付。
- 中途中断: N/A，纯文档交付。
- 边界值: 检查角色列表少一项、多一项或使用“等”省略时冻结测试必失败。
发现分级: P0/P1（凭据泄露、错误放行说明）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA='6230da4a13fad9e43d6316b70914b5b69033ef37'
SPRINT_DIR='sprints/coding-harness-20260903005419-evol42'
DOC='docs/current/attempt-run-桥接使用说明.md'
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-doc-contract.test.ts"
CHANGED_FILES="$(git diff --name-only "$BASE_SHA"...HEAD -- . ":!$SPRINT_DIR")"
[ "$CHANGED_FILES" = "$DOC" ] || { echo "FAIL: 产品范围漂移: $CHANGED_FILES"; exit 1; }
git diff --check "$BASE_SHA"...HEAD
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts` | 两个端点用途与鉴权正反向 oracle 完整 | 目标文档不存在时 ENOENT；缺正向或负向说明时断言失败 |
| 角色封闭集合 | `sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts` | 角色白名单是逐项列名的封闭九项集合且含越界拒绝 | 角色少项、多项、改名或缺拒绝语义时断言失败 |
| payload 合同 | `sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts` | payload 必填与可选语义均有对应负向 oracle | 必填/可选语义漂移或缺负向说明时断言失败 |
| 失败回滚 | `sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts` | 派发失败回滚封闭覆盖三个资源且否定半成功 | 三资源终态少项、多项或暗示半成功时断言失败 |
| 产品范围 | `sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts` | 范围 oracle 只允许唯一 docs 产品文件且冻结基线不漂移 | 文档未生成或出现其他产品文件时断言失败 |
