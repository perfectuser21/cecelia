# Sprint Contract Draft（Round 1）

## 冻结实现基线

`d32b864de5adf8d3083c91f31ed3f5f7f58be985`。所有范围与差异断言都以该 SHA 为准；角色 checkout 的 `workspace_spec.base_sha` 不替换此基线。

## Response Schema（推导来源: PRD 字面）

N/A — 本任务只新增说明文档，无 HTTP 响应或接口行为变更。

## 已知约束（来自回归测试）

- `packages/brain/src/routes/__tests__/harness-attempt-run.test.js` → 角色白名单封闭且为九项；Router 同时挂载 `/attempt-run` 和 `/attempt-run/:attemptId`。
- `tests/gp/f1/step3-attempt-run-endpoint.test.js` → 派发未 LAUNCHED 时回滚 `run→failed`、`session→closed`、`task→cancelled`。
- [累积 FR] 本 line 暂无历史。
- [MAP_NOT_CONFIGURED] task payload 未提供可用的 `map_scope/map_repo`，无 `must_run_assertions`。

gp-anchor: skipped (product-map.json not found)

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 在 `docs/current/attempt-run-bridge-guide.md` 新增一页中文说明，覆盖 PRD 四项内容。 |
| NFR（做得多好） | 内容与冻结基线中的生产 Brain 合同逐字对齐；角色恰好九项。 |
| Invariant（永不违反） | 不改产品代码、测试、接口、鉴权、角色或数据库行为。 |
| 判定点（怎么知道） | 由冻结测试和可执行文档 oracle 判断，见 Test Contract。 |
| 保质期（何时过期） | attempt-run 合同变化时由对应接口变更 PR 同步更新文档。 |
| 死亡告警（停了谁知道） | 冻结测试与合同验收在文档缺失或漂移时失败。 |
| 失败语义（挂了怎么办） | 任一内容或范围 oracle 失败即阻塞交付，不降级。 |
| 效果确认（已发≠已生效） | 读取实际文档并逐项断言，不以文件存在代替内容正确。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失、内容漂移或范围越界 | 验收命令非零退出并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增或修改对外 agent 输入面。

## Golden Path

独立小路（无父路）

[阅读说明] → [按鉴权和角色准备请求] → [POST 派发] → [GET 查询] → [识别失败回滚]

### Step 1：定位中文桥接说明
**来源**: `[FROM_PRD]` — thin_prd“在 docs/current/ 下新增一页《attempt-run 桥接使用说明》”。

**可观测行为**: 指定路径存在中文正文。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"`

**硬阈值**: 唯一产品交付文件为该中文文档；上述命令必须 exit 0。

### Step 2：按端点用途与鉴权准备调用
**来源**: `[FROM_PRD]` — thin_prd 第 1 项。

**可观测行为**: 文档分别解释 POST 派发、GET 查询以及 loopback 与宿主/远端 Bearer 规则。

**验证命令**: `node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Bearer CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))process.exit(1)"`

**硬阈值**: 四个权威字面量全部出现，删去任一字面量后相同 oracle 必须失败。

### Step 3：使用封闭角色白名单
**来源**: `[FROM_PRD]` — thin_prd 第 2 项；名称取自冻结基线的 `ALLOWED_ROLES`。

**可观测行为**: 文档用九个独立列表项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，不宣称开放集合。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t '文档逐项列出且仅列出九个角色白名单'`

**硬阈值**: 精确顺序集合等于上述九项；替换任一项的负向样本必须失败。

### Step 4：填写 payload
**来源**: `[FROM_PRD]` — thin_prd 第 3 项。

**可观测行为**: 文档只把 `sprint_dir`、`base_repo`、`branch` 声明为 payload 必填，并说明 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t '文档说明三个 payload 必填字段和 base_sha 省略语义'`

**硬阈值**: 三个字段均存在且 `base_sha` 为可省略；改成“必填”的负向样本必须失败。不得新增 thin_prd 未要求的 role/title 请求体交付要求。

### Step 5：识别派发失败回滚
**来源**: `[FROM_PRD]` — thin_prd 第 4 项。

**可观测行为**: 文档同时说明 `run→failed`、`session→closed`、`task→cancelled`。

**验证命令**: `npx vitest run --no-cache sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts -t '文档说明派发失败后的三对象回滚终态'`

**硬阈值**: 三个对象与终态全部匹配；删去任一对象的负向样本必须失败。

## 禁 mock 边清单

（本单纯文档改动，不改变调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 真实调用方请求 shape

N/A — 本任务只记录现有接口，不新增或修改调用方请求 shape；文档范围以 thin_prd 四项为限。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

无。本任务只验证冻结基线对应的静态中文文档，不执行或改变真实派发链路。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 查找文档是否误称远端可免 Bearer。
- 重复提交: N/A，静态文档无提交入口。
- 中途中断: N/A，静态文档无异步流程。
- 边界值: 检查角色是否恰好九项、`base_sha` 是否误列为必填。
发现分级: P0/P1 → 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: mac_web

```bash
#!/bin/bash
set -euo pipefail
BASE_SHA=d32b864de5adf8d3083c91f31ed3f5f7f58be985
DOC=docs/current/attempt-run-bridge-guide.md
SPRINT=sprints/coding-harness-20260902140724-6b5mog
npx vitest run --no-cache "$SPRINT/tests/attempt-run-bridge-guide.test.ts"
PRODUCT_DIFF=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^$SPRINT/" || true)
[ "$PRODUCT_DIFF" = "$DOC" ] || { echo "FAIL: 产品范围越界: $PRODUCT_DIFF"; exit 1; }
node -e "const s=require('fs').readFileSync('$DOC','utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"
NEG=$(mktemp)
trap 'rm -f "$NEG"' EXIT
sed '/Bearer CECELIA_INTERNAL_TOKEN/d' "$DOC" > "$NEG"
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');if(s.includes('Bearer CECELIA_INTERNAL_TOKEN'))process.exit(1)" "$NEG"
echo 'attempt-run 桥接文档验收通过'
```

## Test Contract

冻结实现基线：`d32b864de5adf8d3083c91f31ed3f5f7f58be985`

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 端点与鉴权 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | 文档包含两个端点用途和远端 Bearer 鉴权 | 基线 `d32b864de5adf8d3083c91f31ed3f5f7f58be985` 无文档，读取失败 |
| 九项角色 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | 文档逐项列出且仅列出九个角色白名单 | 基线 `d32b864de5adf8d3083c91f31ed3f5f7f58be985` 无文档，读取失败 |
| payload | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | 文档说明三个 payload 必填字段和 base_sha 省略语义 | 基线 `d32b864de5adf8d3083c91f31ed3f5f7f58be985` 无文档，读取失败 |
| 回滚 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | 文档说明派发失败后的三对象回滚终态 | 基线 `d32b864de5adf8d3083c91f31ed3f5f7f58be985` 无文档，读取失败 |
| 范围 | `sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.test.ts` | 文档交付范围只新增指定中文说明且锚定冻结基线 | 基线 `d32b864de5adf8d3083c91f31ed3f5f7f58be985` 无文档，读取失败 |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- 本轮仅产出冻结合同、测试与 task plan，不修改产品代码或新增交付文档。
