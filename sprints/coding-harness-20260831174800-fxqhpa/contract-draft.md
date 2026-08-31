# Sprint Contract Draft（Round 1）

## Notes

- 权威实现基线：`f4f1f511f854ec6fdc0a8512bfe9183181be3fb9`（来自 `inputs.implementation_baseline`）；角色 checkout 的 `workspace_spec.base_sha` 仅选择本轮工作树，不改变该基线。
- contract-gate: 使用 Cecelia 仓内 `packages/brain/src/lib/contract-gate.js`。
- `[MAP_NOT_CONFIGURED]`：task bundle 未提供 map_scope/map_repo，因此无 Unified Map `must_run_assertions` 可注入。
- context-manifest: journey_id 为 none，无可查询的 line 累积 FR；PRD 明示本 line 暂无历史。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: N/A）

N/A — 本 Sprint 仅新增中文说明文档，不新增或修改 HTTP 响应。

## 已知约束

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 角色白名单是冻结的九项集合，且不含 `commander`、`publisher`。
- [`packages/brain/src/middleware/internal-auth.test.js`] → 配置 token 后 loopback 也必须鉴权；未配置 token 时仅非生产 loopback 可调用。
- [累积 FR] 本 line 暂无历史。
- [Invariant] 权威实现基线固定为 `f4f1f511f854ec6fdc0a8512bfe9183181be3fb9`，不得被角色 checkout 或文档中的可省略 `base_sha` 替代。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增一页中文 attempt-run 桥接说明，覆盖两个端点、鉴权、九项角色、payload 与失败回滚。 |
| NFR（做得多好） | 冻结测试读取真实文档并精确断言角色集合、远端鉴权反向语义和三对象回滚；不修改代码。 |
| Invariant（永不违反） | 文档不得把远端写成免鉴权，不得把 `base_sha` 写成必填或权威基线替代物。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 当端点实现、鉴权中间件、角色白名单或 payload 契约变更时，由对应代码变更同步更新文档和冻结测试。 |
| 死亡告警（停了谁知道） | Sprint Tests/合同 E2E 在文档缺失或语义漂移时立即失败，由 PR CI 通知提交者。 |
| 失败语义（挂了怎么办） | 缺节、错角色、远端免鉴权误述或回滚状态不全均阻塞合入，不降级放行。 |
| 效果确认（已发≠已生效） | 测试从仓库树读取文档正文，逐项验证可供调用方阅读的实际文本。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或四节不全 | 测试非零退出并阻塞合入 | 是，补齐后重跑 | 无 |
| 角色集合多、少或拼写漂移 | 测试非零退出并阻塞合入 | 是，按实现白名单修正文档 | 无 |
| 文档暗示宿主/远端可免鉴权 | 反向断言失败并阻塞合入 | 是，修正鉴权表述后重跑 | 无 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入处理面。

## Golden Path

独立小路（无父路）

[读者打开说明] → [选择创建或查询端点] → [按环境携带鉴权并构造 payload] → [理解派发失败回滚终态]

### Step 1：定位两个 attempt-run 端点的用途

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 文档有独立端点用途章节，明确 POST 创建并派发，GET 按 attempt id 查询状态。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t '两个端点用途完整'
```

**硬阈值**: 两个字面端点各出现且用途无互换；上述命令 exit code = 0。

### Step 2：正确理解鉴权边界

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项及「边界情况」远端反例。

**可观测行为**: 文档明确 `internalAuthOrLoopback`，并明确宿主/远端必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`；不得出现宿主或远端免鉴权表述。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t '远端必须 Bearer 且没有免鉴权误述'
```

**硬阈值**: 正向 token 语义与反向禁句同时通过；上述命令 exit code = 0。

### Step 3：按封闭角色集合与 payload 契约创建请求

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 项。

**可观测行为**: 角色章节集合恰等于 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`；payload 明确 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 解析。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t '角色章节集合恰等于九项白名单|payload 必填与 base_sha 省略语义'
```

**硬阈值**: 角色集合严格相等（不接受超集）且字段义务全部通过；上述命令 exit code = 0。

### Step 4：识别派发失败后的收敛终态

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 4 项。

**可观测行为**: 文档同时说明 `run→failed`、`session→closed`、`task→cancelled`，读者不会把失败后的资源误判为仍在执行。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts -t '派发失败三对象自动回滚'
```

**硬阈值**: 三种对象及终态完整出现；上述命令 exit code = 0。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 Sprint 不改变调用 shape；文档按实现基线说明既有接口，不发明额外字段。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（纯文档交付，无真机、第三方 API、异步或 DB 接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否把 `base_sha` 错列为必填。
- 重复提交: N/A，文档无提交入口。
- 中途中断: N/A，文档无运行态。
- 边界值: 检查九项角色有无重复、别名、遗漏或额外第十项。
发现分级: P0/P1（远端免鉴权误导或错误回滚语义）阻塞 merge；P2/P3 记录 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260831174800-fxqhpa"
DOC="docs/current/attempt-run-bridge-guide.md"
test -f "$DOC"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-doc.test.ts"
CHANGED=$(git diff --name-only f4f1f511f854ec6fdc0a8512bfe9183181be3fb9...HEAD)
printf '%s\n' "$CHANGED" | grep -q '^docs/current/attempt-run-bridge-guide.md$'
if printf '%s\n' "$CHANGED" | grep -Eq '^packages/brain/src/|^apps/|^packages/engine/'; then
  echo "FAIL: 文档 Sprint 修改了生产代码"
  exit 1
fi
echo "OK: attempt-run 桥接说明合同通过"
```

通过标准：脚本 exit code = 0；真实文档测试全绿；相对冻结实现基线无生产代码变更。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明 | `sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test.ts` | 两个端点用途完整；远端必须 Bearer 且没有免鉴权误述；角色章节集合恰等于九项白名单；payload 必填与 base_sha 省略语义；派发失败三对象自动回滚 | 文档尚不存在时 5 tests fail（ENOENT） |
