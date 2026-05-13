---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: seed + drive + evidence 采集

**范围**: seed 脚本造演练 W 任务（第 1 轮 FAIL / 第 2 轮 PASS）、drive 脚本驱动 + 轮询 + 5 类证据采集
**大小**: M（100-300 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] seed 脚本存在且 node --check 通过
  Test: node --check packages/brain/scripts/seed-w41-demo-task.js

- [ ] [ARTIFACT] drive 脚本存在且 node --check 通过
  Test: node --check packages/brain/scripts/drive-w41-e2e.js

- [ ] [ARTIFACT] evidence 目录含 5 个非空文件
  Test: bash -c 'EVID=sprints/w41-walking-skeleton-final-b19/evidence; for f in seed-output.json pr-url-trace.txt evaluator-checkout-proof.txt dispatch-events.csv brain-log-excerpt.txt; do [ -s "$EVID/$f" ] || { echo "缺 $f"; exit 1; }; done'

- [ ] [ARTIFACT] seed-output.json 含合法 demo_task_id (UUID v4) + injected_at (ISO 8601)
  Test: bash -c 'jq -e ".demo_task_id | test(\"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\")" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json && jq -e ".injected_at | test(\"^[0-9]{4}-[0-9]{2}-[0-9]{2}T\")" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json'

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑判 PASS/FAIL）

- [ ] [BEHAVIOR] 演练 task 真写入 tasks 表 且 created_at 在过去 24h 内（防 replay 旧任务造假）
  Test: manual:bash -c 'set -e; DB="${DB:-postgresql://localhost/cecelia}"; ID=$(jq -er ".demo_task_id" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json); CNT=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='\''$ID'\'' AND task_type LIKE '\''harness_%'\'' AND created_at > NOW() - interval '\''24 hours'\''"); [ "$CNT" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] fix_dispatch 真触发 → harness_task re-spawn dispatch ≥ 2（首次 + fix 重 spawn）
  Test: manual:bash -c 'set -e; DB="${DB:-postgresql://localhost/cecelia}"; ID=$(jq -er ".demo_task_id" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json); CNT=$(psql "$DB" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='\''$ID'\'' OR task_id IN (SELECT id FROM tasks WHERE payload->>'\''parent_task_id'\''='\''$ID'\'')) AND event_type='\''dispatched'\'' AND reason='\''harness_task'\'' AND created_at > NOW() - interval '\''24 hours'\''"); [ "$CNT" -ge 2 ]'
  期望: exit 0

- [ ] [BEHAVIOR] final evaluate 真跑了 → harness_evaluate dispatch ≥ 2（首轮 FAIL + fix 后 final）
  Test: manual:bash -c 'set -e; DB="${DB:-postgresql://localhost/cecelia}"; ID=$(jq -er ".demo_task_id" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json); CNT=$(psql "$DB" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='\''$ID'\'' OR task_id IN (SELECT id FROM tasks WHERE payload->>'\''parent_task_id'\''='\''$ID'\'')) AND event_type='\''dispatched'\'' AND reason='\''harness_evaluate'\'' AND created_at > NOW() - interval '\''24 hours'\''"); [ "$CNT" -ge 2 ]'
  期望: exit 0

- [ ] [BEHAVIOR] pr-url-trace.txt 跨轮 pr_url+pr_branch 全字面相等 且无空字段（B19 fix 真生效）
  Test: manual:bash -c 'set -e; T=sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt; ROUNDS=$(wc -l < "$T" | tr -d " "); UU=$(awk "{for(i=1;i<=NF;i++)if(\$i~/^pr_url=/)print \$i}" "$T" | sort -u | wc -l | tr -d " "); UB=$(awk "{for(i=1;i<=NF;i++)if(\$i~/^pr_branch=/)print \$i}" "$T" | sort -u | wc -l | tr -d " "); EMPTY=$(grep -cE "pr_url=([[:space:]]|$)|pr_branch=([[:space:]]|$)" "$T" || true); [ "$ROUNDS" -ge 2 ] && [ "$UU" = "1" ] && [ "$UB" = "1" ] && [ "$EMPTY" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] evaluator 容器真 checkout 到 PR 分支（HEAD = origin/PR_BRANCH ≠ origin/main）
  Test: manual:bash -c 'set -e; P=sprints/w41-walking-skeleton-final-b19/evidence/evaluator-checkout-proof.txt; PRB=$(grep -E "^PR_BRANCH=" "$P" | head -1 | cut -d= -f2-); HEAD=$(grep -E "^evaluator_HEAD=" "$P" | head -1 | cut -d= -f2-); [ -n "$PRB" ] && [ -n "$HEAD" ] && [ "$PRB" != "main" ] || exit 1; git fetch origin "$PRB" 2>/dev/null || true; EXP=$(git rev-parse "origin/$PRB" 2>/dev/null); MAIN=$(git rev-parse origin/main 2>/dev/null); [ "$HEAD" = "$EXP" ] && [ "$HEAD" != "$MAIN" ]'
  期望: exit 0

- [ ] [BEHAVIOR] task 端到端收敛 status=completed 且 dev_records.pr_url 与 trace url 字面一致 且 merged_at 非空
  Test: manual:bash -c 'set -e; DB="${DB:-postgresql://localhost/cecelia}"; ID=$(jq -er ".demo_task_id" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json); ST=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='\''$ID'\''"); V=$(psql "$DB" -tAc "SELECT result->>'\''verdict'\'' FROM tasks WHERE id='\''$ID'\''"); DPR=$(psql "$DB" -tAc "SELECT pr_url FROM dev_records WHERE task_id='\''$ID'\'' ORDER BY created_at DESC LIMIT 1"); DM=$(psql "$DB" -tAc "SELECT merged_at FROM dev_records WHERE task_id='\''$ID'\'' ORDER BY created_at DESC LIMIT 1"); TR=$(awk "{for(i=1;i<=NF;i++)if(\$i~/^pr_url=/)print substr(\$i,8)}" sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt | sort -u | head -1); [ "$ST" = "completed" ] && [ -n "$V" ] && [ -n "$DPR" ] && [ -n "$DM" ] && [ "$DPR" = "$TR" ]'
  期望: exit 0
