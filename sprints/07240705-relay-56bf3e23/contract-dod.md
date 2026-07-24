---
skeleton: false
journey_type: agent_remote
target_environment: local_api
harness_gear: segmented
---

# Contract DoD — Codex Slot 安全硬切换

**范围**：从 main 独立实现 broker-only Codex Slot 完整生命周期。

**大小**：L；segmented ws1→ws8 串行。合同 tests 在批准后只读，不属于实现写集。

**done 语义**：逻辑绿但 xian-m1/xian-m4 任一接缝未留证时只能 `logic-done-pending`。

gate-allow: domain/db-no-time-window `information_schema.columns` 是无 `created_at` 的静态 schema introspection；只核对列类型，不用历史业务行证明本轮行为。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 定义 account/lease/session/audit/rollout/observation；audit evidence 含 id/kind/result/run/source/details/freshness，observation 含 production probe source/raw facts；路径列为 TEXT，单账号阻塞租约有唯一约束。
  Test: manual:node -e "const fs=require('fs');const p=fs.readdirSync('packages/brain/migrations').find(x=>x.includes('codex_slot'));if(!p)process.exit(1);const s=fs.readFileSync('packages/brain/migrations/'+p,'utf8');for(const k of ['codex_company_accounts','codex_account_leases','codex_slot_sessions','codex_slot_audit','codex_slot_rollout','codex_slot_agent_observations','evidence_id','evidence_kind','source','details JSONB','observed_at','repo_path TEXT','worktree_path TEXT','UNIQUE','REFERENCES'])if(!s.includes(k))process.exit(1)"

- [ ] [ARTIFACT] root config schema 包含 actor key/UID、xian-m1/xian-m4、max_slots、credential store、固定 agent/audit SSH config 与 `mmv` trust 字段。
  Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/src/codex-slot/config.js','utf8');for(const k of ['actors','uid','ssh_key','xian-m1','xian-m4','max_slots','credential_store','agent_ssh_config','audit_ssh_config','stable_node_id','peer','allowed_ip','backend'])if(!s.includes(k))process.exit(1);if(/38\\.23\\.47\\.81/.test(s))process.exit(1)"

- [ ] [ARTIFACT] client/broker/agent/protocol/credential-store/registry/reaper/rollout 均导出合同操作与稳定错误码。
  Test: manual:node -e "const fs=require('fs');const checks={'scripts/codex-slot-client.sh':['acquire','status','stop','release'],'packages/brain/src/codex-slot/cli.js':['codex-slot-broker'],'packages/brain/src/codex-slot/agent.js':['snapshot_too_large','snapshot_hash_mismatch','nonce_replayed'],'packages/brain/src/codex-slot/protocol.js':['handle_forbidden'],'packages/brain/src/codex-slot/credential-store.js':['262144','fill(0)'],'packages/brain/src/codex-slot/registry.js':['request_id'],'packages/brain/src/codex-slot/reaper.js':['quarantined'],'packages/brain/src/codex-slot/rollout.js':['inventory_complete','broker_only']};for(const [p,ks] of Object.entries(checks)){const s=fs.readFileSync(p,'utf8');for(const k of ks)if(!s.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] 两个旧入口均无直接 scp/auth/tmux issuer 路径，只保留 broker-only 非零指引。
  Test: manual:node -e "const fs=require('fs');for(const p of ['scripts/codex-request.sh','scripts/codex-remote-launch.sh']){const s=fs.readFileSync(p,'utf8');if(/scp|push_token|pull_token|auth\\.json|tmux new-session/.test(s))process.exit(1);if(!/broker-only|codex-slot-client/i.test(s))process.exit(1)}"

- [ ] [ARTIFACT] scheduler-jobs.js 的权威 JOBS 注册 codex-slot-reaper=60000 ms，deprecated tick 路径无接线。
  Test: manual:node -e "const fs=require('fs');const s=fs.readFileSync('packages/brain/src/scheduler-jobs.js','utf8');if(!/codex-slot-reaper[\\s\\S]{0,400}(60000|60_000)/.test(s))process.exit(1);for(const p of ['packages/brain/src/tick-runner.js','packages/brain/src/tick.js']){if(fs.existsSync(p)&&fs.readFileSync(p,'utf8').includes('codex-slot-reaper'))process.exit(1)}"

- [ ] [ARTIFACT] installer 配置 broker service account、forced-command、root/agent/audit 权限、Bash 3.2 零参数分支与失败告警。
  Test: manual:node -e "const s=require('fs').readFileSync('packages/brain/scripts/install-codex-slot.sh','utf8');for(const k of ['codex-slot-broker','codex-slot-agent','codex-slot-audit','forced-command','0600','0710','Bash 3.2','alert'])if(!s.includes(k))process.exit(1)"

- [ ] [ARTIFACT] Ubuntu CI-safe security smoke 在 allowlist 恰登记一次；xian host smoke 位于 real-machine 目录，绝不进入 Ubuntu 无条件 smoke glob。
  Test: manual:node -e "const fs=require('fs');const a='packages/brain/scripts/smoke/codex-slot-security-smoke.sh',b='packages/brain/scripts/real-machine/codex-slot-host-smoke.sh';for(const [p,ks] of [[a,['run_id','session_handle','snapshot_too_large']],[b,['codex-slot-audit','tmux','process','mmv','cleanup']]]){const s=fs.readFileSync(p,'utf8');for(const k of ks)if(!s.includes(k))process.exit(1)}const l=fs.readFileSync('packages/quality/smoke-allowlist.txt','utf8');if(l.split('\\n').filter(x=>x.includes('codex-slot-security-smoke.sh')).length!==1||l.includes('codex-slot-host-smoke.sh'))process.exit(1)"

- [ ] [ARTIFACT] 长期回归位于 Brain unit/integration 目录且分别覆盖 identity、agent auth、transport/auth、lifecycle、reaper/rollout；不依赖批准后只读 sprint tests。
  Test: manual:node -e "const fs=require('fs');for(const p of ['packages/brain/src/__tests__/codex-slot-identity-routing.test.js','packages/brain/src/__tests__/codex-slot-agent-auth.test.js','packages/brain/src/__tests__/codex-slot-protocol-auth.test.js','packages/brain/src/__tests__/integration/codex-slot-lifecycle.integration.test.js','packages/brain/src/__tests__/integration/codex-slot-reaper-rollout.integration.test.js']){const s=fs.readFileSync(p,'utf8');if(!/describe|test|it/.test(s))process.exit(1)}"

- [ ] [ARTIFACT] Mac Bash required job 直接位于 `ci.yml`，真执行 BEH-11 并由 `ci-passed.needs` 依赖；failure/cancelled/skipped 均阻断。xian 双真机仍由 nightly workflow 独立运行。
  Test: manual:node -e "const fs=require('fs');const c=fs.readFileSync('.github/workflows/ci.yml','utf8'),x=fs.readFileSync('.github/workflows/nightly-real-machine.yml','utf8');const m=c.match(/\\n  codex-slot-bash-compat:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n)/),g=c.match(/\\n  ci-passed:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n)/);if(!m||!g)process.exit(1);for(const k of ['runs-on: macos-13','/bin/bash','brew --prefix bash','codex-slot-reaper-rollout.integration.contract.test.ts','Bash 3.2'])if(!m[1].includes(k))process.exit(1);if(!/needs:[^\\n]*codex-slot-bash-compat/.test(g[1])||!g[1].includes('needs.codex-slot-bash-compat.result')||!g[1].includes('!= \"success\"'))process.exit(1);for(const k of ['xian-m1','xian-m4','packages/brain/scripts/real-machine/codex-slot-host-smoke.sh','workflow_dispatch'])if(!x.includes(k))process.exit(1);if(x.includes('packages/brain/scripts/smoke/codex-slot-host-smoke.sh')||fs.existsSync('.github/workflows/codex-slot-bash-compat.yml'))process.exit(1)"

- [ ] [ARTIFACT] DEFINITION 与 Brain VERSION 同步记录 Codex Slot，版本不是 Round 1 基线值。
  Test: manual:node -e "const fs=require('fs');const d=fs.readFileSync('DEFINITION.md','utf8'),v=fs.readFileSync('packages/brain/VERSION','utf8').trim();if(!/Codex Slot|codex slot/i.test(d)||!new RegExp(v.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')).test(d))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] BEH-01 [GP-1] 受控 key/UID 映射 actor，客户端 actor/host/env 自报无效。
  Test: manual:bash -lc 'npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts -t "受控 SSH key 映射 actor|无 UID/SSH key" --reporter=verbose'
  期望：2 tests pass。

- [ ] [BEHAVIOR] BEH-02 [GP-2] 自动选择只接纳 identity/host key/`mmv`/容量/新鲜度全有效的 slot。
  Test: manual:bash -lc 'npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts -t "自动选择仅接纳|容量缺失" --reporter=verbose'
  期望：2 tests pass。

- [ ] [BEHAVIOR] BEH-03 [GP-3] 真 PG 单账号并发只有一个 acquire 成功，相同 request_id 幂等。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t "单账号并发竞争|相同 request_id" --reporter=verbose'
  期望：2 tests pass；fulfilled=1、blocking=1。

- [ ] [BEHAVIOR] BEH-04 [GP-1/7] actor B 对 actor A handle 的 status、stop 与 release 均拒绝。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t "actor B 对 actor A handle" --reporter=verbose'
  期望：1 test pass；真实 E2E 再验 forced-command。

- [ ] [BEHAVIOR] BEH-05 [GP-1/3/7] acquire/status/stop/release/error 的 request/response 精确 keys、类型、enum、稳定 error_code、额外字段拒绝与禁用字段。
  Test: manual:bash -lc 'npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-protocol-auth.contract.test.ts -t "acquire/status/stop/release/error JSON" --reporter=verbose'
  期望：1 test pass；真实 forced-command stdin/argv/env 在 BEH-12 E2E 独立复验。

- [ ] [BEHAVIOR] BEH-06 [GP-5/6] accept-auth 精确 JSON-line+raw+EOF framing、三 key env allowlist、受控 store、hash、跨两个真实 OS 进程 nonce replay、失败零 auth/tmux 与目标 0600。
  Test: manual:bash -lc 'npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-protocol-auth.contract.test.ts -t "accept-auth framing|受控 credential store|snapshot Buffer|snapshot oversize/hash mismatch|nonce durable 消费跨两个真实 OS 进程" --reporter=verbose'
  期望：5 tests pass；metadata keys/types/length、snapshot_bytes/SHA/EOF/零尾随均精确，两个 PID 不同且 replay 文件不存在。

- [ ] [BEHAVIOR] BEH-07 [GP-7] 未知结果只 quarantine，broker 重建后同 handle 可 readback。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t "未知投递结果|重建实例" --reporter=verbose'
  期望：2 tests pass。

- [ ] [BEHAVIOR] BEH-08 [GP-8] production reaper 经真实 SSH/audit probe 新写本轮 raw observation 后计算五分类，client readback 消费结果且终态第二轮 no-op。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "reaper 经 production SSH/audit probe 新写 raw observation" --reporter=verbose'
  期望：5 cases pass；每例 source=production_ssh_audit、observed_at>=trigger、raw facts 与 probe 一致。

- [ ] [BEHAVIOR] BEH-09 [GP-9] inventory 真扫跨 run lease/session/observation 内容，legacy evidence 真记两条 argv/exit/residue；只接受同 run、新鲜、passed 且 source/details 完整的 evidence。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "rollout" --reporter=verbose'
  期望：跨 run alive/unknown/blocking 进入 blockers 且 inventory failed；双旧 argv、非零 exit、broker_only 与 residue=0 持久化。

- [ ] [BEHAVIOR] BEH-10 [GP-9] 两个旧入口以历史真实参数 `--team team1` 与 `--team team3 --brief <fixture>` 真执行，稳定 broker-only 非零语义，隔离 HOME 与真机旧路径零 auth/tmux。
  Test: manual:bash -lc 'npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "旧入口" --reporter=verbose'
  期望：2 parameterized cases pass。

- [ ] [BEHAVIOR] BEH-11 [GP-9/11] 同一 commit 的真实 `CI` run 中，Mac job 真执行 Bash 3.2/现代 Bash test 并成功，随后 `ci-passed` 成功；job skipped 也不得放行。
  Test: manual:bash -lc 'SHA=$(git rev-parse HEAD); RUN_ID=$(gh run list --workflow ci.yml --commit "$SHA" --limit 20 --json databaseId,status,conclusion --jq '"'"'[.[]|select(.status=="completed" and .conclusion=="success")][0].databaseId'"'"'); [ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ]; gh run view "$RUN_ID" --json jobs | jq -e '"'"'[.jobs[]|select(.name=="Codex Slot Bash 3.2 + modern (required)")][0] as $m | [.jobs[]|select(.name=="ci-passed")][0] as $g | $m.conclusion=="success" and any($m.steps[]; .name=="Run BEH-11 on Bash 3.2 and modern Bash" and .conclusion=="success") and $g.conclusion=="success'"'"''
  期望：真实 workflow/job/step/ci-passed 四层 conclusion 均 success。

- [ ] [BEHAVIOR] BEH-12 [GP-1→10] 真 client→broker→agent 双机链，逐 handle 独立查 request/auth transport、源/目标权限、root trust 对比、SSH/PG/tmux/process/reaper readback/清理。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
  期望：exit 0；agent ingress capture 精确 framing/env，reaper observation 新鲜，两个 host 各 5 事件；EXIT trap 后 source/nonce/sandbox、双机资源与 DB fixture 均为 0。

- [ ] [BEHAVIOR] BEH-13 [GP-11] Brain 实际 task payload 的 target_environment 为 local_api。
  Test: manual:bash -lc 'TASK_ID="${HARNESS_TASK_ID:-56bf3e23-1bba-4c6a-8d19-e32d5d746395}"; curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}" | jq -e '"'"'.payload.target_environment == "local_api"'"'"''
  期望：真实任务响应 exit 0。

- [ ] [BEHAVIOR] BEH-14 [GP-3/4] repo/worktree 无天然长度保证，真 schema 必须为 TEXT，handle 为 UUID/TEXT。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}"; psql "$DB_URL" -Atc "SELECT column_name||'"'"'"'"'"':'"'"'"'"'"'||data_type FROM information_schema.columns WHERE table_name='"'"'"'"'"'codex_slot_sessions'"'"'"'"'"' AND column_name IN ('"'"'"'"'"'repo_path'"'"'"'"'"','"'"'"'"'"'worktree_path'"'"'"'"'"','"'"'"'"'"'session_handle'"'"'"'"'"') ORDER BY column_name" | jq -Rsc '"'"'split("\n")[:-1] | sort == ["repo_path:text","session_handle:text","worktree_path:text"] or sort == ["repo_path:text","session_handle:uuid","worktree_path:text"]'"'"''
  期望：exit 0，无 varchar 截断。

- [ ] [BEHAVIOR] BEH-15 [GP-10] provision 与 xian-m1 真 acquire 后故意失败，幂等 EXIT trap 仍清 broker source/nonce/sandbox、双机 auth/tmux/process/worktree 与本轮 account/session/lease。
  Test: manual:bash -lc 'E="sprints/07240705-relay-56bf3e23/evidence/fail-cleanup-$(date +%s)-$$"; awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh; set +e; CODEX_SLOT_E2E_FAIL_AFTER=xian-m1-acquire CODEX_SLOT_EVIDENCE_DIR="$E" bash /tmp/codex-slot-e2e.sh; RC=$?; set -e; [ "$RC" -eq 97 ]; jq -e '"'"'.accounts==0 and .leases==0 and .sessions==0 and .nonterminal_leases==0 and .audit_evidence>=1'"'"' "$E/db-residue.json"; for H in xian-m1 xian-m4; do jq -e '"'"'.auth_files==0 and .tmux_sessions==0 and .processes==0 and .worktrees==0 and .nonce_entries==0 and .sandbox_residue_count==0'"'"' "$E/${H}-trap-residue.json"; done; jq -e '"'"'.ok==true and .idempotent==true'"'"' "$E/deprovision.json"'
  期望：故意失败保留 exit 97；cleanup evidence 保留但 credential/resource 计数全部为 0。

## Invariant 约束逐条映射

- [ ] [BEHAVIOR] INV-01 [GP-11] 冒烟铁律：security smoke 真执行并带本轮 run_id。
  Test: manual:bash -lc 'RUN_ID="inv01-$(date +%s)-$$"; bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh full --run-id "$RUN_ID" | jq -e --arg r "$RUN_ID" ".ok == true and .run_id == \$r"'
- INV-02 — N/A：与 INV-01 字面重复，由 INV-01 单一真实 oracle 覆盖。
- [ ] [BEHAVIOR] INV-03 [GP-8] reaper 状态不重置并真实等待两轮。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "reaper 经 production SSH/audit probe 新写 raw observation" --reporter=verbose'
- INV-04 — N/A：reaper 无 LLM/付费第三方调用。
- [ ] [BEHAVIOR] INV-05 [GP-2/8] freshness 常数满足 `0 < freshness <= 60000`。
  Test: manual:bash -lc 'node -e "Promise.all([import(\"./packages/brain/src/codex-slot/config.js\"),import(\"./packages/brain/src/codex-slot/reaper.js\")]).then(([c,r])=>{if(!(c.MMV_FRESHNESS_MS>0&&c.CAPACITY_FRESHNESS_MS>0&&c.MMV_FRESHNESS_MS<=60000&&c.CAPACITY_FRESHNESS_MS<=60000&&r.REAPER_INTERVAL_MS===60000))process.exit(1)})"'
- INV-06 — N/A：该 theater 关键词规则不属于本功能；合同不引入移动端能力，环境保持 local_api。
- [ ] [BEHAVIOR] INV-07 [GP-11] controller 留存的真实 task payload 明确 local_api。
  Test: manual:bash -lc 'TASK_ID="${HARNESS_TASK_ID:-56bf3e23-1bba-4c6a-8d19-e32d5d746395}"; curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}" | jq -e '"'"'.payload.target_environment == "local_api"'"'"''
- INV-08 — N/A：产品链不调用 Brain judge API。
- [ ] [BEHAVIOR] INV-09 [GP-3/4] 无长度保证的 repo/worktree 以 TEXT 存储。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}"; C=$(psql "$DB_URL" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'"'"'"'codex_slot_sessions'"'"'"'"'"' AND column_name IN ('"'"'"'"'"'repo_path'"'"'"'"'"','"'"'"'"'"'worktree_path'"'"'"'"'"') AND data_type='"'"'"'"'"'text'"'"'"'"'"'"); [ "$C" -eq 2 ]'
- [ ] [BEHAVIOR] INV-10 [GP-11] 新 Codex Slot 路径不复活未审 death history。
  Test: manual:bash -lc 'LOG=$(git log --all --diff-filter=D --format= --name-only -- packages/brain/src/codex-slot scripts/codex-slot-client.sh scripts/codex-slot-agent.sh | sed "/^$/d"); [ -z "$LOG" ] || { echo "FAIL: 新路径命中 deleted history: $LOG"; exit 1; }'
- [ ] [BEHAVIOR] INV-11 [GP-5/6] false/error 返回路径显式拒绝，不靠异常兜底。
  Test: manual:bash -lc 'npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-protocol-auth.contract.test.ts -t "accept-auth framing|snapshot oversize/hash mismatch|nonce durable 消费跨两个真实 OS 进程" --reporter=verbose'
- INV-12 — N/A：与 INV-01 重复的冒烟条目。
- INV-13 — N/A：不改 journey_features/report pipeline。
- INV-14 — N/A：不改 harness-controller finalize/report。
- [ ] [BEHAVIOR] INV-15 [GP-1] headed/headless 均走同一 forced-command 身份，不按 tty 放宽。
  Test: manual:bash -lc 'RUN_ID="inv15-$(date +%s)-$$"; bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh identity-modes --run-id "$RUN_ID" | jq -e ".headed_actor == .headless_actor and .tty_bypass == false"'
- INV-16 — N/A：本产品路径不点火 headed relay。
- [ ] [BEHAVIOR] INV-17 [GP-9] rollout 退役依据来自真 inventory 与双旧入口证据。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "rollout 只接受本 run|旧入口" --reporter=verbose'
- [ ] [BEHAVIOR] INV-18 [GP-8] reaper 失败计数与 sentinel 绑定本轮 run_id。
  Test: manual:bash -lc 'RUN_ID="inv18-$(date +%s)-$$"; bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh reaper-failure --run-id "$RUN_ID"; DB_URL="${DB_URL:-postgresql://localhost/cecelia}"; C=$(psql "$DB_URL" -Atc "SELECT count(*) FROM codex_slot_audit WHERE run_id='"'"'"'"'"'$RUN_ID'"'"'"'"'"' AND event='"'"'"'"'"'reaper_failed'"'"'"'"'"' AND created_at > NOW() - interval '"'"'"'"'"'5 minutes'"'"'"'"'"'"); [ "$C" -eq 1 ]'
- [ ] [BEHAVIOR] INV-19 [GP-3] 新表写入方只在 codex-slot 模块，schema owner 唯一。
  Test: manual:bash -lc 'if HITS=$(rg -l "INSERT INTO codex_(company_accounts|account_leases|slot_sessions|slot_audit|slot_rollout|slot_agent_observations)" packages/brain/src scripts | rg -v "packages/brain/src/codex-slot/"); then echo "$HITS"; exit 1; else RC=$?; [ "$RC" -eq 1 ] || exit "$RC"; fi'
- [ ] [BEHAVIOR] INV-20 [GP-7/8] reaper 从独立事实推导后，由同一 actor 的真实 status/readback 消费 active/released/quarantined 终态。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
- INV-21 — N/A：无 UI；设备差异通过 agent_id 字段对外可见。
- [ ] [BEHAVIOR] INV-22 [GP-7/8] broker/reaper/final E2E 对 unknown 一致为 quarantine。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "未知投递结果|production SSH/audit probe 新写 raw observation 后计算 unknown" --reporter=verbose'
- [ ] [BEHAVIOR] INV-23 [GP-4] worktree ref 必须用 `git rev-parse --verify <ref>^{commit}`。
  Test: manual:bash -lc 'node -e "const s=require(\"fs\").readFileSync(\"packages/brain/src/codex-slot/agent.js\",\"utf8\");if(!/rev-parse[\\s\\S]{0,80}--verify[\\s\\S]{0,80}\\^\\{commit\\}/.test(s))process.exit(1)"'
- [ ] [BEHAVIOR] INV-24 [GP-10] 真机使用 run-scoped sandbox，独立 audit 证实零残留。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
- [ ] [BEHAVIOR] INV-25 [GP-9/11] installer 失败必须非零并写告警，不 warning 降级。
  Test: manual:bash -lc 'RUN_ID="inv25-$(date +%s)-$$"; bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh install-failure --run-id "$RUN_ID" | jq -e ".install_exit_code != 0 and .alert_written == true and .warning_only == false"'
- INV-26 — N/A：不实现部署判变。
- [ ] [BEHAVIOR] INV-27 [GP-11] 合同 tests 通过 test-quality checker。
  Test: manual:bash -lc 'node packages/engine/scripts/devgate/check-test-coverage.cjs'
- [ ] [BEHAVIOR] INV-28 [GP-11] Test Contract 固定 4 个视觉列；checker 的 split cell 3（`cells[2]`）为反引号 test path。
  Test: manual:bash -lc 'node packages/engine/scripts/devgate/check-test-coverage.cjs && node -e "const s=require(\"fs\").readFileSync(\"sprints/07240705-relay-56bf3e23/contract-draft.md\",\"utf8\").split(\"## Test Contract\")[1];for(const line of s.split(\"\\n\").filter(x=>/^\\| WS[0-9]+ /.test(x))){const c=line.split(\"|\");if(c.length!==6||!/`tests\\/.*\\.test\\.ts`/.test(c[2]))process.exit(1)}"'
- INV-29 — N/A：本 commit 的 task_type 是 `harness_contract_propose` 修订轮，依法同时提交 draft/DoD/task-plan/合同 tests，不是 Generator 的 Red-only 实现 commit；批准后 Generator 无权修改合同 tests，并须先精确 add task-plan 指定的长期回归 tests。
- [ ] [BEHAVIOR] INV-30 [GP-11] 被改边测试真跑且零 vi.mock/stub。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests --reporter=verbose; if rg -n "vi\\.mock|jest\\.mock|sinon\\.stub|mockResolvedValue" sprints/07240705-relay-56bf3e23/tests; then exit 1; fi'
- [ ] [BEHAVIOR] INV-31 [GP-8] reaper 只在 scheduler JOBS 接线。
  Test: manual:bash -lc 'npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "scheduler JOBS" --reporter=verbose'
- INV-32 — N/A：merge 权归 controller；计划无 merge。
- INV-33 — N/A：不依赖 headed relay inner shell 环境。
- INV-34 — N/A：本轮按当前真实脚本与 reviewer feedback 重推导，未照抄旧 dispatch 先例。
- [ ] [BEHAVIOR] INV-35 [GP-11] shared allowlist 只新增 Ubuntu-safe security smoke；xian host smoke 明确不登记且由 real-machine workflow 独立调用。
  Test: manual:bash -lc 'BASE=$(git merge-base HEAD origin/main); D=$(git diff --unified=0 "$BASE" -- packages/quality/smoke-allowlist.txt); ADDED=$(printf "%s\n" "$D" | grep -E "^[+][^+]" | wc -l | tr -d " "); REMOVED=$(printf "%s\n" "$D" | grep -E "^-[^-]" | wc -l | tr -d " "); [ "$ADDED" -eq 1 ] && [ "$REMOVED" -eq 0 ] && printf "%s\n" "$D" | grep -q "codex-slot-security-smoke.sh" && ! printf "%s\n" "$D" | grep -q "codex-slot-host-smoke.sh"'
- INV-36 — N/A：PR 早合守卫属于 controller。
- INV-37 — N/A：与 INV-01 重复的冒烟条目。
- [ ] [BEHAVIOR] INV-38 [GP-11] Ubuntu security smoke 与 xian real-machine host smoke 均有业务 oracle，且只有前者进 allowlist。
  Test: manual:bash -lc 'node -e "const fs=require(\"fs\");const a=fs.readFileSync(\"packages/brain/scripts/smoke/codex-slot-security-smoke.sh\",\"utf8\"),b=fs.readFileSync(\"packages/brain/scripts/real-machine/codex-slot-host-smoke.sh\",\"utf8\"),l=fs.readFileSync(\"packages/quality/smoke-allowlist.txt\",\"utf8\");for(const k of [\"snapshot_too_large\",\"handle_forbidden\",\"run_id\"])if(!a.includes(k))process.exit(1);for(const k of [\"codex-slot-audit\",\"tmux\",\"cleanup\",\"xian-m1\",\"xian-m4\"])if(!b.includes(k))process.exit(1);if(l.split(\"\\n\").filter(x=>x.includes(\"codex-slot-security-smoke.sh\")).length!==1||l.includes(\"codex-slot-host-smoke.sh\"))process.exit(1)"'
- INV-39 — N/A：不新增 task_type。
- INV-40 — N/A：不新增网络 daemon；agent 是 forced-command，reaper 用既有 scheduler。
- INV-41 — N/A：美国本机不新增用户域常驻服务。
- INV-42 — N/A：不新增 launchd 常驻服务。
- INV-43 — N/A：与 INV-01 重复的冒烟条目。
- [ ] [BEHAVIOR] INV-44 [GP-11] segmented 恰 8 段串行且实现 files 不含合同 tests。
  Test: manual:bash -lc 'node -e "const p=require(\"./sprints/07240705-relay-56bf3e23/task-plan.json\"),t=p.tasks,owners=new Map;if(p.harness_gear!==\"segmented\"||t.length!==8)process.exit(1);t.forEach((x,i)=>{const w=i?[t[i-1].task_id]:[];if(JSON.stringify(x.depends_on)!==JSON.stringify(w)||x.files.some(f=>f.includes(\"/tests/\")&&f.includes(\"contract\")))process.exit(1);for(const f of x.files){if(owners.has(f))process.exit(1);owners.set(f,x.task_id)}});if(owners.get(\".github/workflows/ci.yml\")!==\"ws6\"||owners.has(\".github/workflows/codex-slot-bash-compat.yml\"))process.exit(1)"'
- [ ] [BEHAVIOR] INV-45 [GP-2/6/10] `mmv` trust 只从 root config 读取并在双机实时校准。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
- [ ] [BEHAVIOR] INV-46 [GP-10] 两台真目标都通过后才 done。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
- INV-47 — N/A：本功能不读写 tenant 数据；actor ownership 由 INV-50 独立验证。
- [ ] [BEHAVIOR] INV-48 [GP-5/10/11] secrets 不硬编码、不进 git/证据/audit。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
- [ ] [BEHAVIOR] INV-49 [GP-5/10/11] audit 只含批准元数据并绑定 run/handle/agent。
  Test: manual:bash -lc 'RUN_ID="inv49-$(date +%s)-$$"; bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh audit-schema --run-id "$RUN_ID" | jq -e ".forbidden_key_hits == 0 and .unbound_rows == 0"'
- [ ] [BEHAVIOR] INV-50 [GP-1/7] acquire/status/stop/release 均经真实 forced-command SSH auth；transport audit 的 request keys 精确，raw 额外身份字段拒绝，actor B 对 status/stop/release 全部 `handle_forbidden`。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
- INV-51 — N/A：无 tenant-scoped 表；account lease 以 actor ownership 隔离，不冒充 tenant。

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] [GP-1→10] local_api evaluator 从真实 client 进入 broker forced-command，再到 xian-m1/xian-m4 agent；同一 run/request/handle 绑定真 PG 与独立远端 oracle。
  Test: manual:bash -lc 'awk '"'"'/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}'"'"' sprints/07240705-relay-56bf3e23/contract-draft.md >/tmp/codex-slot-e2e.sh && bash /tmp/codex-slot-e2e.sh'
  期望：script exit 0；精确 framing/env/schema/auth、双 host、双旧入口、reaper/rollout 均来自真实 source/details；成功 EXIT trap 后 credential/resource/lease 全为 0。
