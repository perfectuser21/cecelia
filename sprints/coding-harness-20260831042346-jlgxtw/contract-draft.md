# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A）

N/A — 本任务只新增使用说明文档，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- [`tests/gp/f1/step3-attempt-run-endpoint.test.js`] → POST 仅允许九个角色、要求 title 与 payload.sprint_dir、成功返回 202 与 attempt_id。
- [`tests/gp/f1/step3-attempt-run-endpoint.test.js`] → 派发未 LAUNCHED 或抛错时，新建桥接资源回滚为 run=failed、session=closed、task=cancelled。
- [`tests/gp/f1/step3-attempt-run-endpoint.test.js`] → GET 返回 result/failure_class 投影，不暴露 callback_secret_hash/lease_owner。
- [累积 FR] context-manifest: unavailable（任务未提供 journey_id）。
- [Unified Map] `[MAP_NOT_CONFIGURED]`：task bundle 未提供 map_scope/map_repo；must_run_assertions 为空。
- gp-anchor: skipped (product-map.json not found)

## Golden Path

独立小路（无父路）

[读者找到文档] → [理解端点与鉴权] → [选择合法角色并填写 payload] → [理解失败回滚]

### Step 1: 读者找到 attempt-run 桥接说明

**来源**: `[FROM_PRD]` — thin_prd 要求在 `docs/current/` 下新增一页《attempt-run 桥接使用说明》。

**可观测行为**: 仓库读者能在 `docs/current/attempt-run-bridge-guide.md` 打开中文说明，并看到 POST 与 GET 两个端点的用途。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!s.includes('POST /api/brain/harness/attempt-run')||!s.includes('GET /api/brain/harness/attempt-run/:id'))process.exit(1)"
```

**硬阈值**: 两个端点路径逐字出现，且文档包含中文字符；以上命令 exit 0。

### Step 2: 读者按部署位置正确鉴权

**来源**: `[FROM_PRD]` — thin_prd 明确要求说明 `internalAuthOrLoopback`，以及宿主/远端必须带 `Bearer CECELIA_INTERNAL_TOKEN`。

**可观测行为**: 读者能区分未配置 token 时的非生产 loopback 与宿主/远端调用，并知道远端请求使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['internalAuthOrLoopback','Authorization: Bearer','CECELIA_INTERNAL_TOKEN','loopback'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 四个鉴权关键字全部存在；以上命令 exit 0。

### Step 3: 读者构造合法派发请求

**来源**: `[FROM_PRD]` — thin_prd 要求九项角色白名单，以及 payload 的 `sprint_dir`、`base_repo`、`branch` 必填，`base_sha` 可省略并由生产 Brain 自解析。

**可观测行为**: 文档逐项列出 `canary`、`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-evidence-repair`、`judge`，并给出不含固定凭据的请求示例。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];const fields=['sprint_dir','base_repo','branch','base_sha'];if(!roles.every(x=>s.includes(x))||!fields.every(x=>s.includes(x))||!s.includes('可省略'))process.exit(1)"
```

**硬阈值**: 九个角色和四个字段逐字出现，明确 `base_sha` 可省略；以上命令 exit 0。

### Step 4: 读者识别派发失败后的原子回滚

**来源**: `[FROM_PRD]` — thin_prd 要求说明派发失败自动回滚 `run→failed/session→closed/task→cancelled`。

**可观测行为**: 文档明确说明仅本次新建的桥接资源在派发失败时回滚，并逐项列出三个终态，避免把失败响应误当已派发。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run','failed','session','closed','task','cancelled','自动回滚'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 回滚对象与终态全部出现；以上命令 exit 0。

### Step 5: 防止文档合同与实现基线漂移

**来源**: `[AI_ADDED]` — 以冻结测试将 thin_prd 的四节要求与当前实现中的九项角色固定下来，避免只创建空文档而假绿。

**可观测行为**: Sprint 冻结测试一次验证文档位置、中文、四节、端点、鉴权、角色、payload 与回滚语义。

**验证命令**:
```bash
npx vitest run --no-cache sprints/coding-harness-20260831042346-jlgxtw/tests/attempt-run-bridge-guide.test.ts
```

**硬阈值**: 1 个测试文件全部通过；以上命令 exit 0。

## 真实调用方请求 shape

本任务不修改调用方或端点。文档示例必须保持生产形状：`POST /api/brain/harness/attempt-run` 使用 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN` 与 `Content-Type: application/json`；JSON 顶层含 `role`、`title`，`payload` 内含 `sprint_dir`、`base_repo`、`branch`，可选 `base_sha`。GET 使用相同 Authorization header，路径参数为 POST 返回的 `attempt_id`。

## 禁 mock 边清单

（本单纯文档改动，不修改调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只交付文档，不执行远端派发或真实世界接缝，N/A。）

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 新增一页中文 attempt-run 桥接使用说明，覆盖 PRD 四项内容。 |
| NFR（做得多好） | 内容可由单条 Vitest 命令确定性校验；不改代码。 |
| Invariant（永不违反） | 不写入 token 字面值；九项白名单与实现一致；implementation baseline 保持 `f06b922d05c1105783b66c22b5912d3430dc2d44`。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 端点、鉴权、角色或 payload 契约变化时由对应代码变更同步更新文档与测试。 |
| 死亡告警（停了谁知道） | 文档缺失或关键词漂移时 Sprint Tests 立即失败并由 PR CI 通知提交者。 |
| 失败语义（挂了怎么办） | 文档验收失败阻塞合并；不得以代码测试既有通过替代文档验收。 |
| 效果确认（已发≠已生效） | 冻结测试从仓库树读取真实文档并断言全部四节内容。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 文档缺失或少任一必需内容 | Vitest 非零退出并阻塞合并 | 是，补齐文档后重跑 | 无降级，不接受缺项 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否说明非白名单 role 会被拒绝。
- 重复提交: 检查相同 `run_id` 的复用描述是否不会与单次派发用途冲突。
- 中途中断: 检查派发失败说明能否明确区分 LAUNCHED 与未 LAUNCHED。
- 边界值: 检查省略 `base_sha` 时的生产 Brain 自解析说明是否明确。
发现分级: P0/P1（泄露凭据或错误指导远端鉴权）阻塞 merge；P2/P3 记录 findings。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge-guide.md'
test -f "$DOC"
node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)" "$DOC"
npx vitest run --no-cache sprints/coding-harness-20260831042346-jlgxtw/tests/attempt-run-bridge-guide.test.ts
git diff --name-only f06b922d05c1105783b66c22b5912d3430dc2d44...HEAD | awk 'BEGIN{ok=1} !(/^docs\/current\/attempt-run-bridge-guide.md$/ || /^sprints\/coding-harness-20260831042346-jlgxtw\//){print "FAIL: 越界文件 " $0;ok=0} END{exit !ok}'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接说明四节完整性 | `sprints/coding-harness-20260831042346-jlgxtw/tests/attempt-run-bridge-guide.test.ts` | `文档覆盖端点、鉴权、九项角色、payload 与失败回滚` | 文档尚未创建，`readFileSync` 抛出 ENOENT，1 test failed |

## Notes

- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)
- gp-anchor: skipped (product-map.json not found)
- 本 Sprint 不受 user_facing staging 预览闸约束。
