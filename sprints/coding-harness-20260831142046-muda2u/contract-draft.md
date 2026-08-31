# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面）

N/A — 本任务只新增现有 HTTP 接口的使用说明，不新增或修改 HTTP 响应。

## 已知约束（来自回归测试）

- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → 角色白名单封闭：包含九个执行角色，永不包含 commander/publisher。
- [`packages/brain/src/routes/__tests__/harness-attempt-run.test.js`] → Router 必须包含 `/attempt-run` 与 `/attempt-run/:attemptId`。
- context-manifest: unavailable（PRD 未提供 journey_id）。
- [MAP_NOT_CONFIGURED] task bundle 未提供 map_scope/map_repo；不回退到领域硬编码。

## 已知回归约束

- 文档内容以当前生产实现 `packages/brain/src/routes/harness-attempt-run.js` 与 `packages/brain/src/middleware/internal-auth.js` 为事实来源。
- 实现基线固定为 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291`；本角色 checkout SHA 不替换该实现基线。
- contract-gate: enabled (`packages/brain/src/lib/contract-gate.js` exists)。
- 本任务不修改 Brain 代码，因此不触发 `DEFINITION.md` 版本更新。

## Golden Path

独立小路（无父路）

[读者找到说明页] → [理解两个端点与鉴权] → [按白名单和 payload 组装请求] → [理解派发失败回滚结果]

### Step 1: 读者找到中文说明页
**来源**: `[FROM_PRD]` — thin PRD“在 cecelia 仓库 docs/current/ 下新增一页”。

**可观测行为**: `docs/current/attempt-run-bridge-guide.md` 存在且包含中文标题。

**验证命令**:
```bash
node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!s.includes('# attempt-run 桥接使用说明'))process.exit(1)"
```

**硬阈值**: 文件存在，标题字面匹配；以上命令 exit 0。

### Step 2: 读者理解端点用途与鉴权
**来源**: `[FROM_PRD]` — thin PRD 第 1 项。

**可观测行为**: 文档分别说明 POST 异步派发与 GET 按 attempt id 轮询结果，并说明 `internalAuthOrLoopback` 及宿主/远端 Bearer token 要求。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['POST /api/brain/harness/attempt-run','GET /api/brain/harness/attempt-run/:id','internalAuthOrLoopback','Authorization: Bearer $CECELIA_INTERNAL_TOKEN'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 四个关键字逐字存在，且正文解释 POST=异步派发、GET=轮询结构化结果；以上命令 exit 0。

### Step 3: 读者按白名单与 payload 组装请求
**来源**: `[FROM_PRD]` — thin PRD 第 2、3 项。

**可观测行为**: 文档完整列出九个允许角色与三个 payload 必填字段，并明确 `base_sha` 可省略、由生产 Brain 自解析。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');const roles=['canary','planner','proposer','reviewer','generator','generator-fix','evaluator','evaluator-evidence-repair','judge'];for(const x of [...roles,'sprint_dir','base_repo','branch','base_sha','生产 Brain'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 九个角色、四个字段名及生产 Brain 自解析说明全部存在；以上命令 exit 0。

### Step 4: 读者理解派发失败的原子回滚
**来源**: `[FROM_PRD]` — thin PRD 第 4 项。

**可观测行为**: 文档明确派发抛错或未返回 `LAUNCHED` 时，新建资源按 run→failed、session→closed、task→cancelled 回滚。

**验证命令**:
```bash
node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const x of ['run → failed','session → closed','task → cancelled','LAUNCHED'])if(!s.includes(x))process.exit(1)"
```

**硬阈值**: 三组状态迁移与触发条件均存在；以上命令 exit 0。

## 真实调用方请求 shape

N/A — 本 Sprint 只记录既有接口用法，不新增设备、agent 或 webhook 调用路径。示例请求仍必须按生产接口使用 JSON body 与 `Authorization` header。

## 禁 mock 边清单

（本单纯文档改动，不改变调度、状态机、跨模块传递、生命周期钩子或 DB 写路径，N/A。）

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 接缝清单

（本单只新增说明文档，不执行或改变真实系统接缝，N/A。）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 新增一页中文 attempt-run 桥接使用说明，覆盖 PRD 四节。 |
| **NFR（做得多好）** | 非功能需求 | 内容与实现基线一致，四节均可由确定性测试检出。 |
| **Invariant（永不违反）** | 不变量 | 只改 `docs/current/` 目标文档与本 Sprint 合同产物，不改代码。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表。 |
| **保质期（何时过期）** | 退役 | 端点、角色、鉴权或 payload 契约变化时由对应代码变更同步更新。 |
| **死亡告警（停了谁知道）** | 告警 | Sprint 冻结测试在文档缺节或漂移时于 CI 立即失败。 |
| **失败语义（挂了怎么办）** | 故障语义 | 缺任一节即阻塞交付，不以部分文档降级放行。 |
| **效果确认（已发≠已生效）** | 回执 | 检查提交树中的目标文档，并逐节匹配契约事实。 |

### 判定点登记表（对模糊现实的判断假设）

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 目标文档缺失 | 冻结测试失败并阻塞交付 | 是 | 无降级 |
| 任一必需章节或事实缺失 | 冻结测试失败并阻塞交付 | 是 | 无降级 |
| 修改范围出现代码文件 | 范围检查失败并阻塞交付 | 是 | 无降级 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写接口。

gp-anchor: skipped (product-map.json not found)

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 检查示例是否误把 `role` 放进 payload，或遗漏 POST 顶层 `title`。
- 重复提交: N/A，文档无运行时提交动作。
- 中途中断: N/A，文档无运行时流程。
- 边界值: 核对九个角色无漏项、重复项或额外角色。
发现分级: P0/P1（误导生产调用或鉴权泄漏）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
DOC='docs/current/attempt-run-bridge-guide.md'
test -f "$DOC"
node - "$DOC" <<'NODE'
const fs = require('fs');
const doc = fs.readFileSync(process.argv[2], 'utf8');
const required = [
  '# attempt-run 桥接使用说明',
  'POST /api/brain/harness/attempt-run',
  'GET /api/brain/harness/attempt-run/:id',
  'internalAuthOrLoopback',
  'Authorization: Bearer $CECELIA_INTERNAL_TOKEN',
  'canary', 'planner', 'proposer', 'reviewer', 'generator', 'generator-fix',
  'evaluator', 'evaluator-evidence-repair', 'judge',
  'sprint_dir', 'base_repo', 'branch', 'base_sha', '生产 Brain',
  'run → failed', 'session → closed', 'task → cancelled', 'LAUNCHED',
];
const missing = required.filter((item) => !doc.includes(item));
if (missing.length) throw new Error(`文档缺少: ${missing.join(', ')}`);
NODE
node -e "const{execFileSync}=require('child_process');const files=execFileSync('git',['diff','--name-only','5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);const extra=files.filter(f=>f!=='docs/current/attempt-run-bridge-guide.md'&&!f.startsWith('sprints/coding-harness-20260831142046-muda2u/'));if(extra.length){console.error('FAIL: 修改超出范围',extra);process.exit(1)}"
echo 'OK: attempt-run 桥接使用说明满足合同'
```

**通过标准**: 脚本 exit 0；目标文档包含四类事实；实现基线外无代码改动。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| attempt-run 桥接文档四节与范围 | `sprints/coding-harness-20260831142046-muda2u/tests/attempt-run-bridge-doc.test.ts` | `目标中文文档存在且包含两个端点用途与鉴权`; `完整列出九项角色白名单`; `说明 payload 必填字段及 base_sha 省略语义`; `说明派发失败自动回滚的三组终态`; `实现范围不包含代码改动` | 目标文档尚不存在，至少首个测试失败 |

## Notes

- 合同只规定文档产出，不要求修改或执行现有端点。
- GAN authoring identity 不进入未来验收；如执行环境需要身份，只能读取 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`。
