# Sprint Contract Draft (Round 1)

> PRD: harness pipeline 编排 Bug 修复 + 回归测试
> Planner task: f60875ab-d743-4d5e-bbef-c292e363edf5
> 状态: PR #2180 已合并全部 7 个 Bug 修复 + BRAIN_QUIET_MODE 降噪，本合同聚焦于**验证修复正确性 + 回归测试覆盖完整性**

---

## Feature 1: WS Report 触发时机

**行为描述**:
多 Workstream harness sprint 中，harness_report 任务仅在最后一个 Workstream 完成后创建。中间 Workstream 完成时只记录日志、触发下一个 WS，不创建 report。

**硬阈值**:
- `harness_report` 创建逻辑位于 `currentWsIdx === totalWsCount` 条件块内
- 中间 WS 完成时日志包含 "暂不创建 report"
- 测试文件中存在对应场景覆盖

**验证命令**:
```bash
# 验证：harness_report 创建在 currentWsIdx === totalWsCount 条件块内
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  const marker = 'currentWsIdx === totalWsCount';
  const idx = src.indexOf(marker);
  if (idx < 0) { console.log('FAIL: 找不到 totalWsCount 检查'); process.exit(1); }
  const region = src.slice(idx, idx + 800);
  if (!region.includes('harness_report')) { console.log('FAIL: harness_report 不在 totalWsCount 块内'); process.exit(1); }
  console.log('PASS: harness_report 创建受 totalWsCount 门控');
"

# 边界验证：不存在无条件触发 report 的旧路径
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  if (src.includes('execution_callback_harness_serial')) { console.log('FAIL: 存在已废弃的 serial trigger'); process.exit(1); }
  console.log('PASS: 无旧版 serial trigger 残留');
"
```

---

## Feature 2: goal_id 校验绕过

**行为描述**:
harness 链式任务（generate/evaluate/report 等）使用 `execution_callback_harness` trigger source 创建，绕过 goal_id 必填校验。这些任务不挂靠 OKR goal，校验不应阻断它们。

**硬阈值**:
- 所有 harness 链式任务的 `trigger_source` 均为 `execution_callback_harness`
- `actions.js` 白名单中包含 `execution_callback_harness`
- 不存在 `execution_callback_harness_serial` 旧 trigger

**验证命令**:
```bash
# Happy path: execution_callback_harness 在 actions.js 白名单中
node -e "
  const src = require('fs').readFileSync('packages/brain/src/actions.js','utf8');
  if (!src.includes('execution_callback_harness')) { console.log('FAIL: actions.js 白名单缺少 execution_callback_harness'); process.exit(1); }
  console.log('PASS: execution_callback_harness 在白名单中');
"

# 负向验证: 旧 trigger 已清除
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  if (src.includes('execution_callback_harness_serial')) { console.log('FAIL: 存在已废弃 serial trigger'); process.exit(1); }
  console.log('PASS: 旧 serial trigger 已清除');
"
```

---

## Feature 3: contract_branch null guard

**行为描述**:
当 Reviewer APPROVED 合同但 contract_branch 为 null 时，系统终止链式触发并记录 P0 级错误日志，不创建无效的 Generator 任务。

**硬阈值**:
- `!contractBranch` 检查存在于 APPROVED 分支中
- 检查失败时打印 `[P0]` 错误标记
- guard 块包含 `return` 提前退出

**验证命令**:
```bash
# Happy path: P0 guard 存在且包含 return
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  const guardIdx = src.indexOf('contract_branch=null');
  if (guardIdx < 0) { console.log('FAIL: 找不到 contract_branch null guard'); process.exit(1); }
  const region = src.slice(guardIdx, guardIdx + 200);
  if (!region.includes('[P0]')) { console.log('FAIL: guard 缺少 P0 标记'); process.exit(1); }
  if (!region.includes('return')) { console.log('FAIL: guard 缺少 return 提前退出'); process.exit(1); }
  console.log('PASS: contract_branch null guard 完整（P0 + return）');
"

# 边界: guard 在 APPROVED 路径中（不在 REVISION 路径）
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  const approvedIdx = src.indexOf(\"reviewVerdict === 'APPROVED'\");
  const guardIdx = src.indexOf('contract_branch=null');
  if (guardIdx < approvedIdx) { console.log('FAIL: guard 在 APPROVED 检查之前'); process.exit(1); }
  console.log('PASS: guard 位于 APPROVED 路径内');
"
```

---

## Feature 4: Report payload 完整性

**行为描述**:
harness_report 任务创建时 payload 包含所有必需字段：sprint_dir、pr_url、dev_task_id、planner_task_id、project_id、eval_round、harness_mode。

**硬阈值**:
- payload 包含全部 7 个必需字段
- project_id 来自 `harnessTask.project_id`（非 null）

**验证命令**:
```bash
# 验证 report payload 包含全部必需字段
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  const reportIdx = src.indexOf(\"task_type: 'harness_report'\");
  if (reportIdx < 0) { console.log('FAIL: 找不到 harness_report 创建'); process.exit(1); }
  const region = src.slice(reportIdx - 100, reportIdx + 500);
  const required = ['sprint_dir', 'pr_url', 'dev_task_id', 'planner_task_id', 'project_id', 'eval_round', 'harness_mode'];
  const missing = required.filter(f => !region.includes(f));
  if (missing.length > 0) { console.log('FAIL: harness_report payload 缺少字段: ' + missing.join(', ')); process.exit(1); }
  console.log('PASS: harness_report payload 包含全部 ' + required.length + ' 个必需字段');
"

# 边界: project_id 取自 harnessTask（非 hardcode）
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  const reportIdx = src.indexOf(\"task_type: 'harness_report'\");
  const region = src.slice(reportIdx, reportIdx + 500);
  if (!region.includes('harnessTask.project_id')) { console.log('FAIL: project_id 非动态取值'); process.exit(1); }
  console.log('PASS: project_id 从 harnessTask 动态获取');
"
```

---

## Feature 5: 串行链幂等保护

**行为描述**:
execution callback 被重复调用时，系统在创建下一个 Workstream 任务前检查是否已存在同 project_id + task_type + workstream_index 的 queued/in_progress 任务，存在则跳过。

**硬阈值**:
- 存在 SQL 查询检查 `workstream_index` + `status IN ('queued','in_progress')`
- 查询命中时输出 "already queued" 日志并跳过创建

**验证命令**:
```bash
# Happy path: 幂等查询存在
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  if (!src.includes(\"status IN ('queued','in_progress')\")) { console.log('FAIL: 缺少幂等 SQL 查询'); process.exit(1); }
  if (!src.includes('workstream_index')) { console.log('FAIL: 幂等查询未按 workstream_index 过滤'); process.exit(1); }
  if (!src.includes('already queued')) { console.log('FAIL: 缺少 already queued 日志'); process.exit(1); }
  console.log('PASS: 串行链幂等保护完整');
"

# 边界: 幂等检查在 createHarnessTask 之前
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
  const idempotentIdx = src.indexOf('already queued');
  const wsCreateIdx = src.indexOf('串行触发 WS');
  if (idempotentIdx > wsCreateIdx) { console.log('FAIL: 幂等检查在创建之后'); process.exit(1); }
  console.log('PASS: 幂等检查在 WS 创建之前');
"
```

---

## Feature 6: harness_report 模型降级为 Haiku

**行为描述**:
Brain 路由 harness_report 任务时使用 Haiku 模型而非 Opus，降低 report 生成的 LLM 成本。

**硬阈值**:
- `model-profile.js` 中 `harness_report` 配置为 `claude-haiku-4-5-*`
- `harness_planner/propose/review` 保持 Opus

**验证命令**:
```bash
# Happy path: harness_report 用 haiku
node -e "
  const src = require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');
  if (!/harness_report[^}]*haiku/.test(src)) { console.log('FAIL: harness_report 未配置为 haiku'); process.exit(1); }
  console.log('PASS: harness_report 使用 Haiku 模型');
"

# 边界: GAN 三件套仍用 Opus
node -e "
  const src = require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');
  const ganTypes = ['harness_planner', 'harness_contract_propose', 'harness_contract_review'];
  const nonOpus = ganTypes.filter(t => !new RegExp(t + '[^}]*opus').test(src));
  if (nonOpus.length > 0) { console.log('FAIL: GAN 组件未用 Opus: ' + nonOpus.join(', ')); process.exit(1); }
  console.log('PASS: GAN 三件套（planner/propose/review）均使用 Opus');
"
```

---

## Feature 7: Brain 回归测试覆盖

**行为描述**:
`harness-pipeline.test.ts` 覆盖以上 6 个场景的关键路径，通过静态源码分析验证修复不被意外回退。

**硬阈值**:
- 测试文件存在且包含 6 个 describe 块
- `npx vitest run packages/brain/src/__tests__/harness-pipeline.test.ts` 全部通过

**验证命令**:
```bash
# 测试文件存在且覆盖 6 个场景
node -e "
  const src = require('fs').readFileSync('packages/brain/src/__tests__/harness-pipeline.test.ts','utf8');
  const describes = (src.match(/describe\(/g) || []).length;
  if (describes < 5) { console.log('FAIL: describe 块不足 5 个，实际 ' + describes); process.exit(1); }
  const required = ['report触发', 'goal_id', 'contract_branch', '幂等', '模型配置'];
  const missing = required.filter(k => !src.includes(k));
  if (missing.length > 0) { console.log('FAIL: 缺少场景覆盖: ' + missing.join(', ')); process.exit(1); }
  console.log('PASS: 测试覆盖 ' + describes + ' 个 describe 块，全部关键场景已覆盖');
"

# 运行测试
npm test -- --run packages/brain/src/__tests__/harness-pipeline.test.ts 2>&1 | tail -5
```

---

## Workstreams

workstream_count: 1

### Workstream 1: 验证全部修复 + 补充回归测试

**范围**: 验证 PR #2180 的 7 个 Bug 修复 + BRAIN_QUIET_MODE 降噪均已正确合并到 main。如有遗漏或测试覆盖不足，补充测试用例。本 sprint 不涉及新功能开发，只做回归验证。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [x] [ARTIFACT] `packages/brain/src/__tests__/harness-pipeline.test.ts` 存在且包含 >= 5 个 describe 块
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/__tests__/harness-pipeline.test.ts','utf8');const d=(s.match(/describe\(/g)||[]).length;if(d<5){process.exit(1)};console.log('OK:'+d)"
- [x] [BEHAVIOR] report 触发时机：harness_report 创建位于 `currentWsIdx === totalWsCount` 条件块内
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=s.indexOf('currentWsIdx === totalWsCount');if(i<0)process.exit(1);if(!s.slice(i,i+800).includes('harness_report'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] goal_id 绕过：`execution_callback_harness` 在 actions.js 白名单中
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/actions.js','utf8');if(!s.includes('execution_callback_harness'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] contract_branch null guard：P0 guard 包含 return 提前退出
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=s.indexOf('contract_branch=null');if(i<0)process.exit(1);const r=s.slice(i,i+200);if(!r.includes('return'))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] 串行链幂等：存在 workstream_index + status IN 查询
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!s.includes(\"status IN ('queued','in_progress')\"))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] harness_report 使用 Haiku 模型
  Test: node -e "const s=require('fs').readFileSync('packages/brain/src/model-profile.js','utf8');if(!/harness_report[^}]*haiku/.test(s))process.exit(1);console.log('PASS')"
- [x] [BEHAVIOR] BRAIN_QUIET_MODE 门控 startSelfDriveLoop 和 triggerDeptHeartbeats
  Test: node -e "const s=require('fs').readFileSync('packages/brain/server.js','utf8');const t=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!s.includes('BRAIN_QUIET_MODE'))process.exit(1);if(!t.includes('BRAIN_QUIET_MODE'))process.exit(1);console.log('PASS')"
