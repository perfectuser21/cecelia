# Sprint Contract Draft (Round 1)

## 合同基线与范围

- authoritative implementation baseline: `perfectuser21/cecelia@d4ae8c6d2b777f5762c4cd88a8e8d56004c66750`（后续角色与 GAN 轮次不得替换）
- 唯一产品交付物：`docs/current/attempt-run-bridge-guide.md`
- 不修改代码、配置或既有文档；合同、DoD、冻结测试和 task plan 属 Harness 治理产物。
- `[MAP_NOT_CONFIGURED]`：task payload 未配置 `map_scope/map_repo`，无 `must_run_assertions`；不回退到领域硬编码。
- gp-anchor: skipped (product-map.json not found)

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 只新增现有端点的使用说明，不新增或修改 HTTP 响应。

## 已知约束

- [回归测试] `packages/brain/src/middleware/internal-auth.test.js` → loopback 与 Bearer token 的鉴权边界不得被文档误述。
- [累积FR] 本 line 暂无历史。
- Unified Map freshness/fact revisions: `[MAP_NOT_CONFIGURED]`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/` 新增一页中文 attempt-run 桥接说明，覆盖端点、鉴权、九角色、payload 与失败回滚。 |
| NFR（做得多好） | 信息完整且可由冻结测试逐节验证；不规定 PRD 外的性能指标。 |
| Invariant（永不违反） | 不展示真实 token；不把远端无鉴权、白名单外角色或缺必填字段描述为有效。 |
| 判定点（怎么知道） | 文档字面与结构测试共同判定；本任务无外部状态推断。 |
| 保质期（何时过期） | API 合同变化时由对应代码变更负责人同步更新；本 Sprint 不虚构版本期限。 |
| 死亡告警（停了谁知道） | 文档冻结测试在 Sprint Tests 中失败并阻断合并。 |
| 失败语义（挂了怎么办） | 任一必需章节缺失、字段误述或范围外文件变更均 fail-closed。 |
| 效果确认（已发≠已生效） | 从提交树读取最终文档并逐项断言四类说明及唯一产品交付路径。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺节或误述 | 冻结测试失败，禁止验收 | 是，修正文档后重跑 | 无降级，fail-closed |
| 出现真实凭据 | 凭据安全断言失败，禁止提交 | 是，删除敏感值后重跑 | 无降级 |

### 输入对抗面

N/A — 本 Sprint 不新增对外 agent 或输入处理能力。

## Golden Path

独立小路（无父路）

[阅读说明] → [按合同创建 attempt] → [按 id 查询] → [辨别成功派发或三对象失败回滚]

### Step 1: 读者识别两个桥接端点及用途
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 项。

**可观测行为**: 中文文档分别说明 POST 用于创建并派发 attempt，GET 用于按 id 查询 attempt-run 状态。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '说明两个端点及各自用途'`

**硬阈值**: 两个端点字面及两种用途全部出现；上述命令 exit 0。

### Step 2: 读者按正确鉴权方式构造请求
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 项与「边界情况」。

**可观测行为**: 文档说明 `internalAuthOrLoopback`，并明确宿主机或远端必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，不展示真实 token。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '说明鉴权与凭据安全'`

**硬阈值**: 鉴权中间件、Bearer 格式、环境变量及宿主/远端约束全部出现，且不存在 token 字面赋值；命令 exit 0。

### Step 3: 读者选择合法角色并填写 payload
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3、4 项。

**可观测行为**: 文档列全九项角色白名单，并将 `sprint_dir/base_repo/branch` 标为必填、`base_sha` 标为可省略且由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '列全九项角色白名单' && npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '说明 payload 必填与 base_sha 省略语义'`

**硬阈值**: 九个且仅九个白名单角色逐字出现，三个字段明确必填，`base_sha` 明确可省略与解析主体；两条命令均 exit 0。

### Step 4: 读者辨别派发失败后的完整回滚
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 5、6 项。

**可观测行为**: 文档同时说明 `run → failed`、`session → closed`、`task → cancelled`，不得只写部分回滚。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t '说明三对象派发失败自动回滚'`

**硬阈值**: 三个对象及最终状态一一对应且同节出现；命令 exit 0。

## 禁 mock 边清单

（本单纯文档改动，不涉及调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本 Sprint 记录既有调用约定但不新增或修改设备/agent 调用服务端的 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（纯文档交付，无真机、第三方 API、异步消息或生产环境接缝，N/A。）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查文档是否把白名单外角色或缺少必填字段的请求写成有效。
- 重复提交: N/A，文档无提交动作。
- 中途中断: N/A，文档无运行时流程。
- 边界值: 检查 `base_sha` 是否被误写为必填，以及回滚是否漏掉任一对象。
发现分级: P0/P1（泄露凭据或导致远端误鉴权）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: mac_web（按冻结 PRD；本纯文档验收仅使用仓库工作区，不启动 UI）

```bash
#!/bin/bash
set -euo pipefail
SPRINT_DIR="sprints/coding-harness-20260901112443-yawt9r"
GUIDE="docs/current/attempt-run-bridge-guide.md"
BASE_SHA="d4ae8c6d2b777f5762c4cd88a8e8d56004c66750"
npx vitest run --no-cache "$SPRINT_DIR/tests/attempt-run-bridge-guide.test.ts" --reporter=verbose
PRODUCT_DIFF=$(git diff --name-only "$BASE_SHA"...HEAD -- docs/current packages apps | sort)
[ "$PRODUCT_DIFF" = "$GUIDE" ] || { echo "FAIL: 产品交付范围漂移: $PRODUCT_DIFF"; exit 1; }
git diff --name-only "$BASE_SHA"...HEAD -- "$GUIDE" | grep -qx "$GUIDE"
echo "OK: attempt-run 桥接使用说明合同验收通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点用途 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | 说明两个端点及各自用途 | guide 不存在，断言失败 |
| 鉴权安全 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | 说明鉴权与凭据安全 | guide 不存在，断言失败 |
| 角色与 payload | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | 列全九项角色白名单；说明 payload 必填与 base_sha 省略语义 | guide 不存在，断言失败 |
| 失败回滚 | `sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts` | 说明三对象派发失败自动回滚 | guide 不存在，断言失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- authoring identity 仅属本轮 provenance；未来 Evaluator/Judge 身份必须从 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind，本合同不固化当前 attempt/snapshot UUID。
