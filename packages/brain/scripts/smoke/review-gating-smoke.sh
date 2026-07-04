#!/usr/bin/env bash
# P2-1 review 分级判定冒烟(纯函数,离线,CI 兼容):新功能人审/非新功能 auto merge/显式覆盖赢
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── review-gating smoke ──"
node --input-type=module -e "
import { deriveReviewRequired } from './src/harness-skill-relay.js';
if (deriveReviewRequired({ title: 'fix: x', payload: {} }) !== false) process.exit(1);
if (deriveReviewRequired({ title: '修复 evaluator 误判', payload: {} }) !== false) process.exit(1);
if (deriveReviewRequired({ title: '随便', payload: { change_kind: 'thicken' } }) !== false) process.exit(1);
if (deriveReviewRequired({ title: 'feat: 新功能', payload: {} }) !== true) process.exit(1);
if (deriveReviewRequired({ title: 'feat: y', payload: { review_required: false } }) !== false) process.exit(1);
" && ok "分级判定五态(fix/修复/thicken→auto;feat→人审;显式赢)" || fail "分级判定"

echo ""; echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
