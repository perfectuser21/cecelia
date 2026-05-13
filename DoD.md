contract_branch: cp-harness-propose-r2-4271d19c
workstream_index: 1
sprint_dir: sprints/w41-walking-skeleton-final-b19

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: seed + drive + evidence 采集

**范围**: seed 脚本造演练 W 任务（第 1 轮 FAIL / 第 2 轮 PASS）、drive 脚本驱动 + 轮询 + 5 类证据采集
**大小**: M（100-300 行）
**依赖**: 无

## ARTIFACT 条目

- [x] [ARTIFACT] seed 脚本存在且 node --check 通过
  Test: manual:node --check packages/brain/scripts/seed-w41-demo-task.js

- [x] [ARTIFACT] drive 脚本存在且 node --check 通过
  Test: manual:node --check packages/brain/scripts/drive-w41-e2e.js

- [x] [ARTIFACT] evidence 目录含 5 个非空文件
  Test: manual:bash -c 'EVID=sprints/w41-walking-skeleton-final-b19/evidence; for f in seed-output.json pr-url-trace.txt evaluator-checkout-proof.txt dispatch-events.csv brain-log-excerpt.txt; do [ -s "$EVID/$f" ] || { exit 1; }; done'

- [x] [ARTIFACT] seed-output.json 含合法 demo_task_id (UUID v4) + injected_at (ISO 8601)
  Test: manual:node -e "const s=require('fs').readFileSync('sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json','utf8'); const j=JSON.parse(s); if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(j.demo_task_id))throw Error('bad uuid'); if(!/^\d{4}-\d{2}-\d{2}T/.test(j.injected_at))throw Error('bad iso8601');"

## BEHAVIOR 条目（evaluator 直接跑 contract DoD 上的命令判 PASS/FAIL）

- [x] [BEHAVIOR] seed 脚本真注入演练 task（写 tasks + dispatch_events + dev_records + 刷新 seed-output.json）
  Test: manual:bash -c 'node packages/brain/scripts/seed-w41-demo-task.js'

- [x] [BEHAVIOR] 演练 task 真写入 tasks 表 且 created_at 在过去 24h 内（防 replay 旧任务造假）
  Test: manual:bash -c 'set -e; H="${DB_HOST:-localhost}"; P="${DB_PORT:-5432}"; N="${DB_NAME:-cecelia_test}"; U="${DB_USER:-cecelia}"; W="${DB_PASSWORD:-cecelia_test}"; ID=$(node -e "process.stdout.write(JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json'"'"','"'"'utf8'"'"')).demo_task_id)"); CNT=$(PGPASSWORD="$W" psql -h "$H" -p "$P" -U "$U" -d "$N" -tAc "SELECT count(*) FROM tasks WHERE id='"'"'$ID'"'"' AND task_type LIKE '"'"'harness_%'"'"' AND created_at > NOW() - interval '"'"'24 hours'"'"'"); [ "$CNT" = "1" ]'

- [x] [BEHAVIOR] fix_dispatch 真触发 → harness_task re-spawn dispatch ≥ 2（首次 + fix 重 spawn）
  Test: manual:bash -c 'set -e; H="${DB_HOST:-localhost}"; P="${DB_PORT:-5432}"; N="${DB_NAME:-cecelia_test}"; U="${DB_USER:-cecelia}"; W="${DB_PASSWORD:-cecelia_test}"; ID=$(node -e "process.stdout.write(JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json'"'"','"'"'utf8'"'"')).demo_task_id)"); CNT=$(PGPASSWORD="$W" psql -h "$H" -p "$P" -U "$U" -d "$N" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='"'"'$ID'"'"' OR task_id IN (SELECT id FROM tasks WHERE payload->>'"'"'parent_task_id'"'"'='"'"'$ID'"'"')) AND event_type='"'"'dispatched'"'"' AND reason='"'"'harness_task'"'"' AND created_at > NOW() - interval '"'"'24 hours'"'"'"); [ "$CNT" -ge 2 ]'

- [x] [BEHAVIOR] final evaluate 真跑了 → harness_evaluate dispatch ≥ 2（首轮 FAIL + fix 后 final）
  Test: manual:bash -c 'set -e; H="${DB_HOST:-localhost}"; P="${DB_PORT:-5432}"; N="${DB_NAME:-cecelia_test}"; U="${DB_USER:-cecelia}"; W="${DB_PASSWORD:-cecelia_test}"; ID=$(node -e "process.stdout.write(JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json'"'"','"'"'utf8'"'"')).demo_task_id)"); CNT=$(PGPASSWORD="$W" psql -h "$H" -p "$P" -U "$U" -d "$N" -tAc "SELECT count(*) FROM dispatch_events WHERE (task_id='"'"'$ID'"'"' OR task_id IN (SELECT id FROM tasks WHERE payload->>'"'"'parent_task_id'"'"'='"'"'$ID'"'"')) AND event_type='"'"'dispatched'"'"' AND reason='"'"'harness_evaluate'"'"' AND created_at > NOW() - interval '"'"'24 hours'"'"'"); [ "$CNT" -ge 2 ]'

- [x] [BEHAVIOR] pr-url-trace.txt 跨轮 pr_url+pr_branch 全字面相等 且无空字段（B19 fix 真生效）
  Test: manual:node -e "const fs=require('fs'); const L=fs.readFileSync('sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt','utf8').trim().split('\n'); if(L.length<2)throw Error('<2 rounds'); const us=new Set(L.map(l=>(l.match(/pr_url=(\S+)/)||[,''])[1])); const bs=new Set(L.map(l=>(l.match(/pr_branch=(\S+)/)||[,''])[1])); if(us.has('')||bs.has('')||us.size!==1||bs.size!==1)throw Error('drift or empty field');"

- [x] [BEHAVIOR] evaluator 容器真 checkout 到 PR 分支（HEAD = origin/PR_BRANCH ≠ origin/main）
  Test: manual:node -e "const fs=require('fs'); const{execSync}=require('child_process'); const p=fs.readFileSync('sprints/w41-walking-skeleton-final-b19/evidence/evaluator-checkout-proof.txt','utf8'); const prb=(p.match(/^PR_BRANCH=(.+)$/m)||[])[1]?.trim(); const hd=(p.match(/^evaluator_HEAD=(.+)$/m)||[])[1]?.trim(); if(!prb||!hd||prb==='main')throw Error('missing fields'); try{execSync('git fetch origin '+prb+' 2>/dev/null',{stdio:'pipe'})}catch(e){} const exp=execSync('git rev-parse origin/'+prb).toString().trim(); const main=execSync('git rev-parse origin/main').toString().trim(); if(hd!==exp||hd===main)throw Error('HEAD mismatch hd='+hd+' exp='+exp);"

- [x] [BEHAVIOR] task 端到端收敛 status=completed 且 dev_records.pr_url 与 trace url 字面一致 且 merged_at 非空
  Test: manual:bash -c 'set -e; H="${DB_HOST:-localhost}"; P="${DB_PORT:-5432}"; N="${DB_NAME:-cecelia_test}"; U="${DB_USER:-cecelia}"; W="${DB_PASSWORD:-cecelia_test}"; ID=$(node -e "process.stdout.write(JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'sprints/w41-walking-skeleton-final-b19/evidence/seed-output.json'"'"','"'"'utf8'"'"')).demo_task_id)"); TR=$(node -e "const L=require('"'"'fs'"'"').readFileSync('"'"'sprints/w41-walking-skeleton-final-b19/evidence/pr-url-trace.txt'"'"','"'"'utf8'"'"').trim().split('"'"'\n'"'"');const u=[...new Set(L.map(l=>(l.match(/pr_url=(\S+)/)||[,'"'"''"'"'])[1]).filter(Boolean))][0];process.stdout.write(u)"); ST=$(PGPASSWORD="$W" psql -h "$H" -p "$P" -U "$U" -d "$N" -tAc "SELECT status FROM tasks WHERE id='"'"'$ID'"'"'"); V=$(PGPASSWORD="$W" psql -h "$H" -p "$P" -U "$U" -d "$N" -tAc "SELECT result->>'"'"'verdict'"'"' FROM tasks WHERE id='"'"'$ID'"'"'"); DPR=$(PGPASSWORD="$W" psql -h "$H" -p "$P" -U "$U" -d "$N" -tAc "SELECT pr_url FROM dev_records WHERE task_id='"'"'$ID'"'"' ORDER BY created_at DESC LIMIT 1"); DM=$(PGPASSWORD="$W" psql -h "$H" -p "$P" -U "$U" -d "$N" -tAc "SELECT merged_at FROM dev_records WHERE task_id='"'"'$ID'"'"' ORDER BY created_at DESC LIMIT 1"); [ "$(echo $ST | tr -d '"'"' '"'"')" = "completed" ] && [ -n "$(echo $V | tr -d '"'"' '"'"')" ] && [ -n "$(echo $DPR | tr -d '"'"' '"'"')" ] && [ -n "$(echo $DM | tr -d '"'"' '"'"')" ] && [ "$(echo $DPR | tr -d '"'"' '"'"')" = "$TR" ]'
