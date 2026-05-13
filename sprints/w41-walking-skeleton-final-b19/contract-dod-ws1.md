---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: 演练任务注入 + 端到端驱动 + 原始证据采集

**范围**: 写 seed 脚本造一个第 1 轮 FAIL / 第 2 轮 PASS 的演练 W 任务、注入 Brain、驱动跑完、抽取 5 类证据文件
**大小**: M（100-300 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] seed 脚本存在且可被 node 运行（语法可解析）
  Test: node --check packages/brain/scripts/seed-w41-demo-task.js

- [ ] [ARTIFACT] drive 脚本存在且可被 node 运行
  Test: node --check packages/brain/scripts/drive-w41-e2e.js

- [ ] [ARTIFACT] evidence 目录存在且含 5 个采集产物
  Test: bash -c 'EVID=sprints/w41-walking-skeleton-final-b19/evidence; for f in seed-output.json pr-url-trace.txt evaluator-checkout-proof.txt dispatch-events.csv brain-log-excerpt.txt; do [ -s "$EVID/$f" ] || { echo "缺 $f"; exit 1; }; done'

- [ ] [ARTIFACT] seed-output.json 是合法 JSON 且含 demo_task_id (UUID v4) + injected_at (ISO 8601)
  Test: bash -c 'jq -e ".demo_task_id | test(\"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\")" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json && jq -e ".injected_at | test(\"^[0-9]{4}-[0-9]{2}-[0-9]{2}T\")" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json'

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑判 PASS/FAIL）

- [ ] [BEHAVIOR] 演练 task 真写入 tasks 表且过去 24 小时内（防 replay 旧任务造假）
  Test: manual:bash -c 'set -e; DB="${DB:-postgresql://localhost/cecelia}"; ID=$(jq -er ".demo_task_id" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json); COUNT=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE id='\''$ID'\'' AND task_type LIKE '\''harness_%'\'' AND created_at > NOW() - interval '\''24 hours'\''"); [ "$COUNT" = "1" ]'
  期望: exit 0

- [ ] [BEHAVIOR] fix 循环真触发 ≥ 2 次 harness_evaluate dispatch（证 evaluate→FAIL→fix→evaluate 链路真走过）
  Test: manual:bash -c 'set -e; DB="${DB:-postgresql://localhost/cecelia}"; ID=$(jq -er ".demo_task_id" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json); CNT=$(psql "$DB" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='\''$ID'\'' OR task_id IN (SELECT id FROM tasks WHERE payload->>'\''parent_task_id'\''='\''$ID'\'')) AND event_type='\''dispatched'\'' AND COALESCE(reason,'\'''\'') ILIKE '\''%harness_evaluate%'\'' AND created_at > NOW() - interval '\''24 hours'\''"); [ "$CNT" -ge 2 ]'
  期望: exit 0

- [ ] [BEHAVIOR] pr-url-trace.txt 跨轮 pr_url 全等且 pr_branch 全等且无空（B19 fix 真生效证据）
  Test: manual:bash -c 'set -e; T=sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt; ROUNDS=$(wc -l < "$T" | tr -d " "); UU=$(awk "{for(i=1;i<=NF;i++)if(\$i~/^pr_url=/)print \$i}" "$T" | sort -u | wc -l | tr -d " "); UB=$(awk "{for(i=1;i<=NF;i++)if(\$i~/^pr_branch=/)print \$i}" "$T" | sort -u | wc -l | tr -d " "); EMPTY=$(grep -cE "pr_url=$|pr_branch=$" "$T" || true); [ "$ROUNDS" -ge 2 ] && [ "$UU" = "1" ] && [ "$UB" = "1" ] && [ "$EMPTY" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] evaluator 容器真 checkout 到 PR 分支（HEAD = origin/PR_BRANCH ≠ origin/main）
  Test: manual:bash -c 'set -e; P=sprints/w41-walking-skeleton-final-b19/evidence/evaluator-checkout-proof.txt; PRB=$(grep -E "^PR_BRANCH=" "$P" | head -1 | cut -d= -f2); HEAD=$(grep -E "^evaluator_HEAD=" "$P" | head -1 | cut -d= -f2); [ -n "$PRB" ] && [ -n "$HEAD" ] && [ "$PRB" != "main" ] || exit 1; git fetch origin "$PRB" 2>/dev/null || true; EXP=$(git rev-parse "origin/$PRB" 2>/dev/null); MAIN=$(git rev-parse origin/main 2>/dev/null); [ "$HEAD" = "$EXP" ] && [ "$HEAD" != "$MAIN" ]'
  期望: exit 0

- [ ] [BEHAVIOR] task 端到端收敛 status=completed 且 dev_records.pr_url 与 trace url 字面一致（fix 循环全程 URL 未漂直到 merge）
  Test: manual:bash -c 'set -e; DB="${DB:-postgresql://localhost/cecelia}"; ID=$(jq -er ".demo_task_id" sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json); ST=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='\''$ID'\''"); V=$(psql "$DB" -tAc "SELECT result->>'\''verdict'\'' FROM tasks WHERE id='\''$ID'\''"); DPR=$(psql "$DB" -tAc "SELECT pr_url FROM dev_records WHERE task_id='\''$ID'\'' ORDER BY created_at DESC LIMIT 1"); DM=$(psql "$DB" -tAc "SELECT merged_at FROM dev_records WHERE task_id='\''$ID'\'' ORDER BY created_at DESC LIMIT 1"); TRACE=$(awk "{for(i=1;i<=NF;i++)if(\$i~/^pr_url=/)print substr(\$i,8)}" sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt | sort -u | head -1); [ "$ST" = "completed" ] && [ -n "$V" ] && [ -n "$DPR" ] && [ -n "$DM" ] && [ "$DPR" = "$TRACE" ]'
  期望: exit 0
