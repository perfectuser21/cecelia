#!/usr/bin/env bash
# dispatch-code-routing-smoke.sh
# 验收：决策 bf361265 —— dev 任务改代码强制路由进 harness_initiative
#   1) task_type='dev' + 默认仓库 + 无 doc/bugfix/large 关键词 → 路由命中，gear=default
#   2) 标题含"修复bug" → 路由命中，gear=hotfix
#   3) 标题含"新增能力/立项" → 路由命中，gear=segmented
#   4) 非 dev task_type → 不路由
#   5) 纯文档标题（docs:）→ 不路由
#   6) 非默认仓库（v1 范围限制）→ 不路由
#   7) buildHarnessRoutingPayload 产出的五个字段（orchestrator/code_change/gear/origin_task_type/thin_prd）齐全
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAIN_SRC="$SCRIPT_DIR/../../src"

node --input-type=module -e "
import { classifyCodeChange, deriveGearForTask, buildHarnessRoutingPayload } from '$BRAIN_SRC/dispatch-code-routing.js';

let pass = 0, fail = 0;
const ok = (m) => { console.log('✅ ' + m); pass++; };
const bad = (m) => { console.log('❌ ' + m); fail++; };

// 1. 默认仓库 + 无关键词 → 路由命中，gear=default
const t1 = { task_type: 'dev', title: '加个新接口', description: '给用户列表加分页参数', payload: {} };
const c1 = classifyCodeChange(t1);
(c1.isCodeChange === true && c1.reason === 'code_change' && deriveGearForTask(t1) === 'default')
  ? ok('默认仓库无关键词 dev 任务 → 路由命中，gear=default')
  : bad('用例1失败: ' + JSON.stringify(c1) + ' gear=' + deriveGearForTask(t1));

// 2. 标题含修复bug → hotfix
const t2 = { task_type: 'dev', title: '修复bug：派发死锁', description: '', payload: {} };
(classifyCodeChange(t2).isCodeChange === true && deriveGearForTask(t2) === 'hotfix')
  ? ok('标题含\"修复bug\" → 路由命中，gear=hotfix')
  : bad('用例2失败: gear=' + deriveGearForTask(t2));

// 3. 标题含新增能力/立项 → segmented
const t3 = { task_type: 'dev', title: '新增能力：多平台一键发布', description: '这是一次立项，贯穿全流程', payload: {} };
(classifyCodeChange(t3).isCodeChange === true && deriveGearForTask(t3) === 'segmented')
  ? ok('标题含\"新增能力/立项\" → 路由命中，gear=segmented')
  : bad('用例3失败: gear=' + deriveGearForTask(t3));

// 4. 非 dev task_type → 不路由
const t4 = { task_type: 'research', title: '调研一下X', payload: {} };
const c4 = classifyCodeChange(t4);
(c4.isCodeChange === false && c4.reason === 'not_dev_type')
  ? ok('非 dev task_type → 不路由')
  : bad('用例4失败: ' + JSON.stringify(c4));

// 5. 纯文档标题 → 不路由
const t5 = { task_type: 'dev', title: 'docs: 更新 README', payload: {} };
const c5 = classifyCodeChange(t5);
(c5.isCodeChange === false && c5.reason === 'doc_or_config_only')
  ? ok('纯文档标题（docs:）→ 不路由')
  : bad('用例5失败: ' + JSON.stringify(c5));

// 6. 非默认仓库（v1范围限制）→ 不路由
const t6 = { task_type: 'dev', title: '修一下发布器的bug', payload: { repo: 'zenithjoy' } };
const c6 = classifyCodeChange(t6);
(c6.isCodeChange === false && c6.reason === 'non_default_repo_v1_scope_limit')
  ? ok('非默认仓库（v1范围限制）→ 不路由')
  : bad('用例6失败: ' + JSON.stringify(c6));

// 7. buildHarnessRoutingPayload 五个字段齐全
const t7 = { task_type: 'dev', title: '加个新接口', description: '给用户列表加分页参数', payload: { context: '只加 GET /users 的分页' } };
const patch = buildHarnessRoutingPayload(t7, 'default');
(patch.orchestrator === 'skill-relay'
  && patch.code_change === true
  && patch.gear === 'default'
  && patch.origin_task_type === 'dev'
  && typeof patch.thin_prd === 'string' && patch.thin_prd.includes('加个新接口'))
  ? ok('buildHarnessRoutingPayload 五字段齐全（含 thin_prd 合成）')
  : bad('用例7失败: ' + JSON.stringify(patch));

console.log(\`── \${pass} pass / \${fail} fail ──\`);
process.exit(fail === 0 ? 0 : 1);
"
