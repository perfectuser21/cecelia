#!/usr/bin/env bash
# four-cell-router-smoke.sh — Crystal 件1 冒烟(结构+行为,零外部依赖)
# 1) execution 类永不路由 kernel-harness-v2 2) intake 默认 tenant_id:'default' 不算执行标记
set -euo pipefail
cd "$(dirname "$0")/../.."

node --input-type=module -e "
import { classifyArtifactKind, classifyAnswerKnown, selectPipeline } from './src/work-router.js';

// ① execution 永不进 kernel(meta 三杀手回归防线)
const d = selectPipeline({ work_kind: 'coding_mutation', artifact_kind: 'execution', answer_known: false });
if (d.orchestrator === 'kernel-harness-v2' || d.pipeline !== 'canvas' || d.canonical_task_type !== 'exploratory') {
  console.error('FAIL: execution 被路由进 kernel 或落点不对', d); process.exit(1);
}

// ② intake 默认注入的 tenant_id:'default' 不算执行标记(30 任务回放实证)
if (classifyArtifactKind({ payload: { tenant_id: 'default' } }) !== 'code') {
  console.error('FAIL: tenant_id=default 被误判 execution'); process.exit(1);
}
if (classifyArtifactKind({ payload: { tenant_id: 'jinoshengyuan' } }) !== 'execution') {
  console.error('FAIL: 真租户未判 execution'); process.exit(1);
}

// ③ answer_known 三层优先级
if (classifyAnswerKnown({ answer_known: false }) !== false) { console.error('FAIL: 显式布尔未优先'); process.exit(1); }
if (classifyAnswerKnown({ declared_change_kind: 'bugfix' }) !== true) { console.error('FAIL: bugfix 未默认 known'); process.exit(1); }
if (classifyAnswerKnown({ description: '先探索一下' }) !== false) { console.error('FAIL: 探索词未判 unknown'); process.exit(1); }

// ④ code 类老契约不破
try { selectPipeline({ work_kind: 'coding_mutation', artifact_kind: 'code' }); console.error('FAIL: 缺 change_kind 未抛'); process.exit(1); }
catch (e) { if (e.message !== 'change_kind_required') { console.error('FAIL: 异常语义变了', e.message); process.exit(1); } }

console.log('✅ four-cell-router smoke 通过(execution隔离/标记判据/answer优先级/老契约)');
"
