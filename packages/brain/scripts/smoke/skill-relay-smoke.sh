#!/usr/bin/env bash
# skill-relay 接线冒烟：路由判断 + judge-cli 参数解析（离线，不依赖 DB/docker/DeepSeek）。
set -euo pipefail
cd "$(dirname "$0")/../.."   # packages/brain
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── skill-relay smoke ──"

# 1. 双轨路由判断：flag 命中/缺省
node --input-type=module -e "
import { isSkillRelayTask } from './src/harness-skill-relay.js';
if (isSkillRelayTask({ payload: { orchestrator: 'skill-relay' } }) !== true) process.exit(1);
if (isSkillRelayTask({ payload: {} }) !== false) process.exit(1);
" && ok "isSkillRelayTask 双轨判断" || fail "isSkillRelayTask"

# 2. judge-cli 用法门：缺必填 exit 非 0，--help 级错误信息含用法
node ../../scripts/harness-judge-cli.mjs --task-id only 2>/dev/null && fail "judge-cli 缺参未拦" || ok "judge-cli 缺参拦截"

# 3. judge-cli 全参解析（纯函数，CI 兼容——skill symlink 部署状态属本机运维，不进 CI 冒烟）
node --input-type=module -e "
import { parseCliArgs } from '../../scripts/harness-judge-cli.mjs';
const a = parseCliArgs(['--task-id','t','--sprint-dir','s','--worktree','/w']);
if (a.taskId !== 't' || a.worktree !== '/w') process.exit(1);
" && ok "judge-cli 全参解析" || fail "judge-cli 解析"

# 4. P2-1 review 分级判定(纯函数,离线)
node --input-type=module -e "
import { deriveReviewRequired } from './src/harness-skill-relay.js';
if (deriveReviewRequired({ title: 'fix: x', payload: {} }) !== false) process.exit(1);
if (deriveReviewRequired({ title: 'feat: 新功能', payload: {} }) !== true) process.exit(1);
if (deriveReviewRequired({ title: 'feat: y', payload: { review_required: false } }) !== false) process.exit(1);
" && ok "review 分级判定(fix→auto/feat→人审/显式赢)" || fail "review 分级判定"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
