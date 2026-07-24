---
skeleton: false
journey_type: agent_remote
target_environment: local_api
---

# Contract DoD — 完整 Codex Slot 安全硬切换（Round 3）

**范围**：仅 PRD 的 broker-only Codex Slot 硬切、全局账号租约、既有 SSOT、durable/frozen、API/stop/reaper 与双机 fake-auth。
**状态纪律**：全未勾；L3 在 final-e2e 前为 `logic-done-pending`。

## ARTIFACT 条目

- [ ] [ARTIFACT] A01 control plane、四路生产 caller、bridge receiver 与 `/accounts` 两消费者完整接线
  Test: manual:bash -c 'node -e "const f=require(\"node:fs\");const req=[\"packages/brain/src/routes/codex-slots.js\",\"packages/brain/src/codex-slot-broker.js\",\"packages/brain/src/codex-slot-reaper.js\",\"packages/brain/src/executor.js\",\"packages/brain/src/harness-skill-relay.js\",\"packages/brain/scripts/codex-bridge/codex-bridge.cjs\",\"packages/brain/src/routes/brain-meta.js\",\"packages/brain/src/credentials-health-scheduler.js\"];for(const p of req){if(!f.existsSync(p)){console.error(\"RED missing \"+p);process.exit(1)}}const e=f.readFileSync(req[3],\"utf8\"),h=f.readFileSync(req[4],\"utf8\"),b=f.readFileSync(req[5],\"utf8\"),m=f.readFileSync(req[6],\"utf8\"),c=f.readFileSync(req[7],\"utf8\"),w=f.readFileSync(\"packages/brain/src/routes.js\",\"utf8\");if(!w.includes(\"codex-slots\")||/accounts\\s*:\\s*injectedAccounts|pickLocalAccountByDeficit/.test(e)||/account_id\\s*:/.test(h)||/loadRawAuth|injectLocalAccount|setupInjectedAccounts/.test(b)||/CODEX_BRIDGE_URL[\\s\\S]{0,300}\\/accounts/.test(m)||/CODEX_BRIDGE_URL[\\s\\S]{0,300}\\/accounts/.test(c)||!m.includes(\"account_usage_cache\")||!c.includes(\"account_usage_cache\")){console.error(\"RED issuer bypass or consumer regression remains\");process.exit(1)}"'
  期望: Node 真启动；三路 executor/harness relay 无 raw auth/account_id；bridge 无 fallback；两个消费者只读安全 cache。

- [ ] [ARTIFACT] A02 migration 建 durable identity/lease/session/rollout/audit，公司 account_ref 全局 blocking 唯一且不建平行 agent 表
  Test: manual:bash -c 'node -e "const f=require(\"node:fs\"),p=\"packages/brain/migrations/360_codex_slot.sql\";if(!f.existsSync(p)){console.error(\"RED missing migration\");process.exit(1)}const s=f.readFileSync(p,\"utf8\");for(const x of [\"codex_slot_actor_identities\",\"identity_kind\",\"identity_ref\",\"uid\",\"ssh_key\",\"codex_slot_leases\",\"codex_slot_sessions\",\"codex_slot_rollout\",\"codex_slot_audit_events\",\"tenant_id\",\"account_ref\",\"active\",\"quarantined\",\"blocked\"]){if(!s.includes(x)){console.error(\"RED missing \"+x);process.exit(1)}}if(/CREATE TABLE[^;]*codex_slot_agents/is.test(s)||!(/UNIQUE INDEX[\\s\\S]*\\(account_ref\\)[\\s\\S]*active[\\s\\S]*quarantined[\\s\\S]*blocked/i.test(s))){console.error(\"RED global index/SSOT violation\");process.exit(1)}"'
  期望: Node exit 0；UID/key mapping 为 durable object；唯一索引 key 不含 tenant_id；无 `codex_slot_agents`。

- [ ] [ARTIFACT] A03 client/agent 语法通过，installer 在 Bash 3.2 与现代 Bash 各真跑失败隔离场景
  Test: manual:bash -c '/bin/bash -n scripts/codex-request.sh scripts/codex-remote-launch.sh; bash -n scripts/codex-request.sh scripts/codex-remote-launch.sh; for p in scripts/codex-slot scripts/codex-slot-client.mjs scripts/codex-slot-agent.mjs scripts/install-codex-slot.sh; do [ -f "$p" ] || { echo "RED missing $p" >&2; exit 1; }; done; node --check scripts/codex-slot-client.mjs; node --check scripts/codex-slot-agent.mjs; MODERN_BASH=$(command -v bash); /bin/bash --version | grep -q "version 3\\.2"; "$MODERN_BASH" --version | grep -Eq "version ([4-9]|[1-9][0-9])\\."; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; run_fail(){ SH="$1"; ROOT="$2"; set +e; O=$(CODEX_SLOT_CONFIG="$T/missing.json" "$SH" scripts/install-codex-slot.sh --install-root "$ROOT" 2>&1); R=$?; set -e; [ "$R" -eq 78 ] && { [ ! -e "$ROOT" ] || [ -z "$(find "$ROOT" -type f -print -quit)" ]; } || { printf "FAIL shell=%s rc=%s out=%s\n" "$SH" "$R" "$O" >&2; return 1; }; }; run_fail /bin/bash "$T/bash32"; run_fail "$MODERN_BASH" "$T/modern"'
  期望: `/bin/bash` 3.2 与 modern Bash≥4 均真实执行 installer 并 exit 78；两个隔离根都无半安装文件。

- [ ] [ARTIFACT] A04 root 配置只保存 agent attest/machine/fleet 映射；fake auth 明示不可真实认证
  Test: manual:bash -c 'node -e "const f=require(\"node:fs\"),cp=\"config/codex-slot/agents.example.json\",fp=\"scripts/fixtures/codex-slot/fake-auth.json\";for(const p of [cp,fp])if(!f.existsSync(p)){console.error(\"RED missing \"+p);process.exit(1)}const c=JSON.parse(f.readFileSync(cp)),raw=f.readFileSync(fp,\"utf8\"),a=JSON.parse(raw);if(!Array.isArray(c.agents)||c.agents.length!==2||!c.agents.every(x=>x.agent_id&&x.machine_registry_name&&x.fleet_id&&x.mmv?.stable_node_id&&Array.isArray(x.mmv.allowed_ips))||a.fixture!==true||!/not.a.real.token/i.test(raw)||/sk-[A-Za-z0-9_-]{16,}/.test(raw))process.exit(1)"'
  期望: Node exit 0；两台映射齐全、stable ID/IP 不取 hostname，fixture 无真 token。

- [ ] [ARTIFACT] A05 smoke/allowlist/scheduler/版本四件套同步
  Test: manual:bash -c 'node -e "const f=require(\"node:fs\"),s=\"packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh\";if(!f.existsSync(s)){console.error(\"RED missing smoke\");process.exit(1)}if(!f.readFileSync(\"packages/quality/smoke-allowlist.txt\",\"utf8\").includes(\"codex-slot-lifecycle-smoke.sh\")||!f.readFileSync(\"packages/brain/src/scheduler-jobs.js\",\"utf8\").includes(\"codex-slot-reaper\"))process.exit(1);const v=JSON.parse(f.readFileSync(\"packages/brain/package.json\")).version,d=f.readFileSync(\"DEFINITION.md\",\"utf8\"),l=f.readFileSync(\".brain-versions\",\"utf8\").trim().split(/\\n/).at(-1);if(v===\"1.267.61\"||!d.includes(v)||l!==v)process.exit(1)"'
  期望: Node exit 0；smoke 登记、reaper 接 scheduler-jobs、Brain 版本已 bump。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B01 GP1 两个旧脚本用合法旧参数时在任何网络/auth/tmux 前 exit 64
  动作: 用只记录调用的 ssh/scp/codex/tmux tripwire，真启动两个旧 Bash 脚本的合法参数。
  预期观察: 两者均 exit 64、只输出 `codex-slot start` 迁移提示，tripwire 记录为空。
  验证命令: Test: manual:bash -c 'set -uo pipefail; T=$(mktemp -d); trap '\''rm -rf "$T"'\'' EXIT; TRACE="$T/trace"; mkdir -p "$T/home"; for C in ssh scp codex tmux; do printf '\''#!/bin/sh\nprintf "called\\n" >> "%s"\nexit 97\n'\'' "$TRACE" > "$T/$C"; chmod +x "$T/$C"; done; F=0; run_one(){ P="$1"; shift; set +e; O=$(HOME="$T/home" PATH="$T:/usr/bin:/bin" CODEX_BIN=codex CODEX_US_HOST=forbidden CODEX_REMOTE_HOST=forbidden bash "$P" "$@" 2>&1); R=$?; set -e; [ "$R" -eq 64 ] && printf "%s\n" "$O" | grep -q "codex-slot start" || { printf "FAIL %s rc=%s out=%s\n" "$P" "$R" "$O" >&2; return 1; }; }; run_one scripts/codex-request.sh --team team1 || F=1; run_one scripts/codex-remote-launch.sh --team team3 || F=1; [ ! -s "$TRACE" ] || { echo "FAIL child command invoked" >&2; F=1; }; [ "$F" -eq 0 ]'
  期望: 外层/产品 Bash 均启动；两次 rc=64；零网络、零 auth 文件读取、零 tmux。

- [ ] [BEHAVIOR] [L2] B02 GP4 三路 executor 与 harness relay 各先取 broker receipt，`/accounts` 消费者不断链
  动作: 分别触发 explicit codex、location=xian、location=xian_m1、harness relay 四个生产 caller；捕获真实 `/run`；再真跑 codex-usage/refresh 与 credentials health。
  预期观察: 4/4 broker IDs/receipt 与 `/run.slot` 相同；无 account_id/raw auth/fallback；bridge `/accounts`=410 且两个消费者只读 `account_usage_cache`、均不成为 issuer。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; O=$("$S" --case production-callers-broker-only --json); printf "%s\n" "$O" | jq -e ".ok==true and (.callers|keys==[\"executor_explicit\",\"executor_xian\",\"executor_xian_m1\",\"harness_relay\"]) and ([.callers[]|select(.broker.issuer==\"broker\" and .broker.lease_id==.run.body.slot.lease_id and .broker.session_id==.run.body.slot.session_id and .broker.receipt==.run.body.slot.receipt and .broker.agent_id==.run.body.slot.agent_id and (.run.headers|keys==[\"authorization\",\"content-type\",\"idempotency-key\"]))]|length)==4 and ([.callers[].run.body|select(has(\"account_id\") or has(\"accounts\") or has(\"auth\") or has(\"token\") or has(\"account_ref\") or has(\"github_token\") or has(\"anthropic_api_key\"))]|length)==0 and .bridge.local_auth_reads==0 and .bridge.fallback_attempts==0 and .bridge.accounts_code==410 and .bridge.health_has_accounts==false and .consumers.brain_meta.source==\"account_usage_cache\" and .consumers.brain_meta.http_codes==[200,200] and .consumers.credentials_health.source==\"account_usage_cache\" and .consumers.credentials_health.completed==true and .consumers.bridge_accounts_calls==0 and .consumers.raw_auth_reads==0"; RID=$(printf "%s\n" "$O"|jq -er ".request_id"); [[ "$RID" =~ ^[0-9a-f-]{36}$ ]] || exit 1; DB="${DB_URL:-postgresql://localhost/cecelia}"; N=$(psql "$DB" -Atqc "SELECT count(*) FROM codex_slot_audit_events WHERE request_id='\''$RID'\'' AND created_at>NOW()-interval '\''5 minutes'\'' AND payload::text ~* '\''(account_id|access_token|refresh_token|auth_json|prompt|full_env)'\''"); [ "$N" -eq 0 ]'
  期望: 真四 caller/HTTP receiver/两消费者/PostgreSQL；禁止汇总单 caller 或 mock 替代。

- [ ] [BEHAVIOR] [L2] B03 GP1 authenticated frozen、inventory 与 cutover fault 保持 durable frozen
  动作: 以正确 Bearer/identity 调 acquire，依次制造 inventory 未完成和每个 cutover step failure。
  预期观察: 均为 423 exact error 且 lease=0；每个 failure 后 PostgreSQL rollout 仍 frozen；全步骤完成才 open。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; O=$("$S" --case frozen-inventory-cutover --json); printf "%s\n" "$O" | jq -e ".ok==true and .authenticated_frozen.http_code==423 and (.authenticated_frozen.body|keys==[\"error\",\"ok\"]) and .authenticated_frozen.body.ok==false and .authenticated_frozen.body.error=={\"code\":\"ROLLOUT_FROZEN\",\"message\":\"codex slot rollout is frozen\",\"retryable\":true} and .inventory_incomplete.http_code==423 and .inventory_incomplete.body.error==.authenticated_frozen.body.error and .leases_created==0 and ([.faults[]|select(.rollout_state==\"frozen\")]|length)==(.faults|length) and .opened.inventory_complete==true"; ID=$(printf "%s\n" "$O"|jq -er ".rollout_id"); [[ "$ID" =~ ^[0-9a-f-]{36}$ ]] || exit 1; DB="${DB_URL:-postgresql://localhost/cecelia}"; X=$(psql "$DB" -Atqc "SELECT state||'\'':'\''||inventory_complete FROM codex_slot_rollout WHERE id='\''$ID'\''"); [ "$X" = "open:true" ]'
  期望: 真实鉴权/DB/cutover；任一 partial failure 不开放。

- [ ] [BEHAVIOR] [L2] B04 GP2 两 tenant 竞争同一公司 account_ref 全局只得一个 blocking lease，并复用既有 deficit 语义
  动作: 以两个 tenant 真并发同 account_ref acquire；另用专用 usage snapshot 走 broker 的既有排序入口。
  预期观察: HTTP code 排序为 201/409，全局 blocking count=1；选择满足 5h≤95 后 deficit 最大且同 deficit 5h 最低的 account_ref。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; G=$("$S" --case global-account-contention --json); U=$("$S" --case usage-deficit-selection --json); printf "%s\n" "$G" | jq -e ".ok==true and ([.attempts[].http_code]|sort)==[201,409] and ([.attempts[]|select(.http_code==409 and .body.ok==false and .body.error=={\"code\":\"ACCOUNT_BUSY\",\"message\":\"account already has a blocking lease\",\"retryable\":true})]|length)==1 and .global_blocking_leases==1 and .tenant_ids[0]!=.tenant_ids[1]"; printf "%s\n" "$U" | jq -e ".ok==true and .rule==\"existing-deficit\" and .over_95_excluded==true and .selected_account_ref==.expected_account_ref"; A=$(printf "%s\n" "$G"|jq -er ".account_ref"); [[ "$A" =~ ^[A-Za-z0-9_-]+$ ]] || exit 1; DB="${DB_URL:-postgresql://localhost/cecelia}"; N=$(psql "$DB" -Atqc "SELECT count(*) FROM codex_slot_leases WHERE account_ref='\''$A'\'' AND state IN ('\''active'\'','\''quarantined'\'','\''blocked'\'') AND updated_at>NOW()-interval '\''5 minutes'\''"); [ "$N" -eq 1 ]'
  期望: 真 PG 并发；唯一索引 key 为 account_ref 全局语义，不因 tenant 不同放行。

- [ ] [BEHAVIOR] [L2] B05 GP2 durable write 每个 fault 真 kill/restart/replay 后无第二 lease/session/audit
  动作: 在 lease/session/audit/commit/response 边界逐点故障，kill Brain/broker，重启后同键并发重放。
  预期观察: PID 变化且 PostgreSQL 为真；每个 fault 最终 blocking lease/session/acquire audit 均为 1，响应 IDs 相同、unknown_success=false。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; O=$("$S" --case durable-crash-restart --json); printf "%s\n" "$O" | jq -e ".ok==true and .postgresql_real==true and (.faults|length)>=5 and ([.faults[]|select(.pid_before!=.pid_after and .blocking_leases==1 and .sessions==1 and .acquire_audits==1 and .same_ids==true and .unknown_success==false)]|length)==(.faults|length)"'
  期望: 每 case ≤60s；真实进程重启、真 PG、非 mock DB。

- [ ] [BEHAVIOR] [L2] B06 GP1 mapped UID/forced-command SSH key、authority 拒绝与有限 error matrix
  动作: 真实 adapter 分别用 mapped UID/key acquire；再发未知/伪造 mapping、逐 CLI/body authority 字段、六个无效 Bearer 与六类真实失败请求。
  预期观察: mapped 两支 201；identity 两支 403；authority 在网络/lease 前 64/400；七类 code↔HTTP↔message↔retryable exact，拒绝 lease=0。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; O=$("$S" --case identity-authority-error-matrix --json); printf "%s\n" "$O" | jq -e ".ok==true and .mapped.uid.http_code==201 and .mapped.uid.identity_kind==\"uid\" and .mapped.ssh_key.http_code==201 and .mapped.ssh_key.identity_kind==\"ssh_key\" and .mapped.uid.actor_id!=.mapped.ssh_key.actor_id and ([.forbidden[]|select(.http_code==403 and .body.ok==false and .body.error=={\"code\":\"FORBIDDEN_IDENTITY\",\"message\":\"identity is not mapped\",\"retryable\":false})]|length)==2 and .authority.cli.exit_code==64 and .authority.cli.network_attempts==0 and .authority.cli.rejected_fields==[\"account\",\"account_ref\",\"accounts\",\"actor\",\"agent\",\"agent_id\",\"auth\",\"host\",\"team\",\"tenant\",\"token\"] and .authority.body.http_code==400 and .authority.body.leases_created==0 and .authority.body.rejected_fields==.authority.cli.rejected_fields and ([.auth[]|select(.http_code==401 and .body.error=={\"code\":\"UNAUTHENTICATED\",\"message\":\"authentication required\",\"retryable\":false})]|length)==6 and ([.errors[]|select(.request_count==1 and ((.code==\"INVALID_REQUEST\" and .http_code==400 and .message==\"request does not match the exact schema\" and .retryable==false) or (.code==\"FORBIDDEN_IDENTITY\" and .http_code==403 and .message==\"identity is not mapped\" and .retryable==false) or (.code==\"ACCOUNT_BUSY\" and .http_code==409 and .message==\"account already has a blocking lease\" and .retryable==true) or (.code==\"ROLLOUT_FROZEN\" and .http_code==423 and .message==\"codex slot rollout is frozen\" and .retryable==true) or (.code==\"AGENT_UNAVAILABLE\" and .http_code==503 and .message==\"no healthy codex slot agent available\" and .retryable==true) or (.code==\"DURABILITY_FAILED\" and .http_code==503 and .message==\"durable write failed\" and .retryable==true)))]|length)==6 and .leases_created_on_reject==0"'
  期望: 真 adapter/client/Brain/PG；每个矩阵元素来自一次真请求，404/汇总布尔不接受。

- [ ] [BEHAVIOR] [L2] B07 GP2 acquire 同 Idempotency-Key 两次返回相同 UUID/handle/agent enum，副作用各一次
  动作: smoke 以真实 adapter shape 连续两次 acquire，并直查近 5 分钟 DB。
  预期观察: 两次 201 body 字面相同；exact keys/types；UUID 合法；agent 仅 xian-m1/xian-m4；lease/session/audit 各 1。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; O=$("$S" --case api-idempotent-acquire --json); printf "%s\n" "$O" | jq -e ".ok==true and .first.http_code==201 and .replay.http_code==201 and .first.body==.replay.body and (.first.body|keys==[\"ok\",\"session\"]) and .first.body.ok==true and (.first.body.session|keys==[\"agent_id\",\"handle\",\"lease_id\",\"session_id\",\"status\"]) and (.first.body.session.handle|type==\"string\" and length>0) and (.first.body.session.agent_id==\"xian-m1\" or .first.body.session.agent_id==\"xian-m4\") and .first.body.session.status==\"running\""; SID=$(printf "%s\n" "$O"|jq -er ".first.body.session.session_id"); LID=$(printf "%s\n" "$O"|jq -er ".first.body.session.lease_id"); RID=$(printf "%s\n" "$O"|jq -er ".request_id"); [[ "$SID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ && "$LID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ && "$RID" =~ ^[0-9a-f-]{36}$ ]] || exit 1; DB="${DB_URL:-postgresql://localhost/cecelia}"; N=$(psql "$DB" -Atqc "SELECT (SELECT count(*) FROM codex_slot_leases WHERE request_id='\''$RID'\'' AND updated_at>NOW()-interval '\''5 minutes'\'')||'\'':'\''||(SELECT count(*) FROM codex_slot_sessions WHERE request_id='\''$RID'\'' AND updated_at>NOW()-interval '\''5 minutes'\'')||'\'':'\''||(SELECT count(*) FROM codex_slot_audit_events WHERE request_id='\''$RID'\'' AND event_type='\''acquired'\'' AND created_at>NOW()-interval '\''5 minutes'\'' )"); [ "$N" = "1:1:1" ]'
  期望: 真 API/PG/receiver；直接比较两 body，不接受汇总布尔替代。

- [ ] [BEHAVIOR] [L2] B08 GP3 agent 身份/容量只来自 machine/fleet/slot SSOT，时间常数严格递增且 stale fail closed
  动作: 直查 system_registry 与不存在的平行表，再让 broker 读取真实 fleet/slot 状态及 root 映射。
  预期观察: 两个 machine 映射；`codex_slot_agents` 不存在；来源字段 exact；stale/missing 可用数=0；health TTL < heartbeat stale < quarantine review TTL。
  验证命令: Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; M=$(psql "$DB" -Atqc "SELECT count(*) FROM system_registry WHERE type='\''machine'\'' AND status='\''active'\'' AND metadata->>'\''agent_id'\'' IN ('\''xian-m1'\'','\''xian-m4'\'') AND metadata ? '\''fleet_id'\''"); [ "$M" -eq 2 ] || { echo "RED machine mappings=$M" >&2; exit 1; }; X=$(psql "$DB" -Atqc "SELECT to_regclass('\''codex_slot_agents'\'') IS NULL"); [ "$X" = t ]; S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; "$S" --case machine-fleet-usage-ssot --json | jq -e ".ok==true and .identity_source==\"system_registry\" and .capacity_source==\"fleet-resource-cache\" and .concurrency_source==\"slot-allocator\" and .stale.available==0 and .missing.available==0 and (.ttl.health_ms < .ttl.heartbeat_stale_ms and .ttl.heartbeat_stale_ms < .ttl.quarantine_review_ms)"'
  期望: 真 PG + 真相邻模块；无固定容量 fallback。

- [ ] [BEHAVIOR] [L3] B09 GP4/GP5 双机正常 receive→私有 durable 落盘→fixture launch→stop，并保留 mmv race
  动作: xian-m1/xian-m4 各走正常 prepare/receive/launch/stop，再走 prepare→receive 与 receive→launch 出口变化支。
  预期观察: fake auth hash 证明确实读取；父目录 0700/文件 0600 且 file/parent fsync；响应无 secret；fixture PID/tmux 真运行后清理；竞态仍拒绝。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; for H in xian-m1 xian-m4; do O=$("$S" --case protected-delivery-and-launch --host "$H" --json); printf "%s\n" "$O" | jq -e --arg h "$H" ".ok==true and .host==\$h and .normal.received==true and .normal.auth_read==true and .normal.parent_mode==\"0700\" and .normal.auth_mode==\"0600\" and .normal.fsync_file==true and .normal.fsync_parent==true and .normal.fixture_sha256==.normal.read_sha256 and .normal.response_secret_bytes==0 and .normal.launch.exit_code==0 and .normal.launch.fixture_pid>1 and .normal.launch.process_running==true and .normal.launch.tmux_present==true and .normal.stop.cleanup.auth_absent==true and .normal.stop.cleanup.tmux_absent==true and .normal.stop.cleanup.temp_absent==true and .normal.stop.cleanup.lease_state==\"released\" and .prepare.predicate_id==.launch.predicate_id and .race.read_auth==false and .race.wrote_auth==false and .race.launch_rejected==true and .race.cleanup.auth_absent==true and .race.cleanup.tmux_absent==true and .race.cleanup.temp_absent==true and .race.cleanup.lease_state!=\"released\"" || exit 1; done'
  期望: 本地 Bash、SSH、双机 agent、mmv、FS、tmux 均真执行；当前 `logic-done-pending`。

- [ ] [BEHAVIOR] [L3] B10 GP6 stop 两次 exact body 相同且 release/audit 副作用各一次
  动作: fake-auth session 连续两次调用真实 stop endpoint，并让 agent 真实 cleanup。
  预期观察: 两次 200 body 相同；UUID/keys/types exact；cleanup 四项通过；DB release transition=1、stop audit=1。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; O=$("$S" --case idempotent-stop --json); printf "%s\n" "$O" | jq -e ".ok==true and .first.http_code==200 and .replay.http_code==200 and .first.body==.replay.body and (.first.body|keys==[\"ok\",\"session\"]) and .first.body.ok==true and (.first.body.session|keys==[\"cleanup\",\"handle\",\"session_id\",\"status\"]) and (.first.body.session.session_id|type==\"string\" and test(\"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\")) and (.first.body.session.handle|type==\"string\" and length>0) and .first.body.session.status==\"stopped\" and (.first.body.session.cleanup|keys==[\"auth_absent\",\"lease_state\",\"temp_absent\",\"tmux_absent\"]) and (.first.body.session.cleanup.auth_absent|type==\"boolean\") and (.first.body.session.cleanup.temp_absent|type==\"boolean\") and (.first.body.session.cleanup.tmux_absent|type==\"boolean\") and .first.body.session.cleanup.auth_absent==true and .first.body.session.cleanup.tmux_absent==true and .first.body.session.cleanup.temp_absent==true and .first.body.session.cleanup.lease_state==\"released\" and .effects.release_transitions==1 and .effects.stop_audits==1"; RID=$(printf "%s\n" "$O"|jq -er ".request_id"); [[ "$RID" =~ ^[0-9a-f-]{36}$ ]] || exit 1; DB="${DB_URL:-postgresql://localhost/cecelia}"; N=$(psql "$DB" -Atqc "SELECT count(*) FILTER (WHERE event_type='\''lease_released'\'')||'\'':'\''||count(*) FILTER (WHERE event_type='\''session_stopped'\'') FROM codex_slot_audit_events WHERE request_id='\''$RID'\'' AND created_at>NOW()-interval '\''5 minutes'\''"); [ "$N" = "1:1" ]'
  期望: 真 endpoint/agent/FS/tmux/PG；直接比较两 body 与计数。

- [ ] [BEHAVIOR] [L2] B11 GP6 reaper 两轮 summary 全非负 integer，连续失败持久计数并写唯一 P0 Bark receipt
  动作: 同一 PG 状态两轮 reaper；再连续制造配置阈值次失败，Bark 指向本地 capture sink。
  预期观察: 不可达 released=0；summary exact/integer；working_memory failure_count 达阈值；action_receipts 近 5 分钟恰一条 severity=P0 的 bark。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; O=$("$S" --case reaper-two-pass-and-alert --json); printf "%s\n" "$O" | jq -e ".ok==true and (.first.summary|keys==[\"checked\",\"heartbeat_updated\",\"quarantined\",\"released\"]) and (.second.summary|keys==[\"checked\",\"heartbeat_updated\",\"quarantined\",\"released\"]) and ([.first.summary[],.second.summary[]]|all(type==\"number\" and .>=0 and floor==.)) and .first.unreachable_released==0 and .second.unreachable_released==0 and .failure_count==.failure_threshold and .alert.severity==\"P0\""; A=$(printf "%s\n" "$O"|jq -er ".alert.action_id"); [[ "$A" =~ ^[0-9a-f-]{36}$ ]] || exit 1; DB="${DB_URL:-postgresql://localhost/cecelia}"; N=$(psql "$DB" -Atqc "SELECT count(*) FROM action_receipts WHERE action_id='\''$A'\'' AND kind='\''bark'\'' AND created_at>NOW()-interval '\''5 minutes'\'' AND evidence->>'\''severity'\''='\''P0'\''"); [ "$N" -eq 1 ]'
  期望: 真 scheduler/reaper/PG/notifier receipt；仅 Bark 外网由本地 capture sink 替代。

- [ ] [BEHAVIOR] [L2] B12 GP2/GP6 两 tenant 不串且近 5 分钟 audit 无 secret/prompt/full auth/env
  动作: 两 tenant 分别 acquire/stop，并用真实 PostgreSQL tenant-scope 查询。
  预期观察: own_count=1、cross_count=0；audit_secret_rows=0；window_minutes=5。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED missing $S" >&2; exit 1; }; "$S" --case tenant-isolation-and-redaction --json | jq -e ".ok==true and .tenant_a.own_count==1 and .tenant_a.cross_count==0 and .tenant_b.own_count==1 and .tenant_b.cross_count==0 and .audit_secret_rows==0 and .window_minutes==5"'
  期望: 真 PG、两个 tenant、时间窗 5 分钟。

## Invariant 逐条覆盖（53/53）

| INV | 铁律 | 可执行映射或 N/A |
|---|---|---|
| INV-01 | manual 真退出码/解释器启动 | 本轮逐条预检记录 A01-A05/B01-B12 rc 与日志。 |
| INV-02 | manual node 插值真运行 | N/A：无 `manual:node`；A01/A02/A04/A05 的 Node 仍真启动。 |
| INV-03 | smoke | A05、B02-B05、B07-B12、E2E。 |
| INV-04 | smoke | A05、B02-B05、B07-B12、E2E。 |
| INV-05 | 周期扫描不只冷启动 | B11 同一 PG 状态两轮。 |
| INV-06 | 付费重扫前置检查 | N/A：reaper 不调用付费 API。 |
| INV-07 | 时间常数关系 | **B08** 真加载配置并执行 `health_ms < heartbeat_stale_ms < quarantine_review_ms`。 |
| INV-08 | 环境路由非 theater | B09/E2E 真 SSH 双机；payload target 仍 local_api。 |
| INV-09 | target_environment 来自 payload | front matter + E2E 均为 local_api。 |
| INV-10 | judge exit/log tail | N/A：harness judge 协议，非产品范围。 |
| INV-11 | 受限字段截断 | B06 error message、B02/B12 audit 输入均受限。 |
| INV-12 | 退役死因核验 | 已知约束 + B01/B02。 |
| INV-13 | null/false 失败分支 | B03/B05/B08/B09/B11 fail closed。 |
| INV-14 | smoke | A05、B02-B05、B07-B12、E2E。 |
| INV-15 | journey 报告漏跑探针 | N/A：不改 journey report。 |
| INV-16 | merge 后 report 收口 | N/A：不改 harness merge/report。 |
| INV-17 | headed 接管白名单 | N/A：无 headed shell；receiver forced action。 |
| INV-18 | headed relay payload | N/A：不点火 headed relay。 |
| INV-19 | 退役需生产消费者证据 | **B01 + B02 + A01**：三路 executor、harness relay 与 brain-meta/credentials-health 两个 `/accounts` 消费者逐一真跑；退役端点/fallback 无旁路且消费者不断链。 |
| INV-20 | 后台失败计数/P0/Bark | **B11**：连续失败阈值、working_memory 与近 5 分钟唯一 P0 Bark action_receipt。 |
| INV-21 | 建表前核写入方 | A02/B08：不建 agent 表；broker/reaper 写业务表。 |
| INV-22 | 后台落库消费者 | B07/B10/B11 真实消费 lease/session/audit。 |
| INV-23 | 多设备 UI 区分 | N/A：无 UI；B09 以 agent_id 区分双机。 |
| INV-24 | 判变/终验语义一致 | **B09**：双机 prepare/launch 返回同一 `predicate_id` 并走真实 mmv。 |
| INV-25 | git ref verify | N/A：产品路径不判断 git ref。 |
| INV-26 | worktree smoke 不碰生产 | N/A：fake-auth session 临时根，不创建 worktree。 |
| INV-27 | installer 失败非零 | **A03**：macOS `/bin/bash` 3.2 与 modern Bash≥4 分别真执行隔离 installer，均须 exact exit 78 且无半安装；`bash -n` 不代替。 |
| INV-28 | 生产自报对账 main | N/A：不做版本判变；agent 自报对 root 配置。 |
| INV-29 | 异步质量 await 真调用 | B02/B05/B11 通过真实 async caller/重启/scheduler。 |
| INV-30 | Test Contract 四列 | contract-draft Test Contract 固定四列。 |
| INV-31 | Red 精确暂存 | 仅 stage 本 sprint 四类产物。 |
| INV-32 | 接线回归非仅 mock | A01 + B02 + B11。 |
| INV-33 | cron 查 scheduler-jobs | A05/B11；不用 tick-runner。 |
| INV-34 | generator 不合并 | 只 push 分支，由 controller 合并。 |
| INV-35 | headed tmux env | N/A：无 headed relay；agent metadata root 文件化。 |
| INV-36 | 历史派发核对 | Notes/已知约束；只用 R1 锁定合同与 main。 |
| INV-37 | 共享 CI 禁改 | task-plan 不改共享 workflow。 |
| INV-38 | PR SHA 对 verdict | N/A：controller pre-merge。 |
| INV-39 | smoke | A05、B02-B05、B07-B12、E2E。 |
| INV-40 | brain/src PR smoke/allowlist | A05。 |
| INV-41 | 新 task type 全接线 | N/A：不新增 task_type。 |
| INV-42 | 服务存活查 launchctl+端口 | N/A：不新增常驻端口服务；现有 bridge 接 receiver。 |
| INV-43 | 美国 Mac LaunchDaemon | N/A：不新增常驻服务。 |
| INV-44 | launchd patrol manifest | N/A：不新增常驻服务。 |
| INV-45 | smoke | A05、B02-B05、B07-B12、E2E。 |
| INV-46 | 单槽串行 | A02/B04/B05。 |
| INV-47 | 环境值推导 | A04/B08/B09。 |
| INV-48 | 真机未验不得 done | B09/B10/E2E 前保持 `logic-done-pending`。 |
| INV-49 | 两 tenant 不串 | B04/B12/E2E。 |
| INV-50 | secret 不进 git/log | A04/B02/B12。 |
| INV-51 | PII/prompt 不明文日志 | B02/B12。 |
| INV-52 | 每 API 端点鉴权 | **B06** 对 acquire/stop/reap 各做 missing + wrong Bearer 共 6 个真实 401 exact-oracle。 |
| INV-53 | tenant scope | A02/B12；全局 account 锁仅唯一性跨 tenant，不开放跨 tenant 读。 |

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api 控制面 + 真实 executor/user caller + xian-m1/xian-m4 fake-auth 完整生命周期
  执行体: `contract-draft.md` 的单一 `## E2E 验收` bash 块。
  期望: 4/4 caller broker-only、identity/error exact、全局账号唯一、双机正常 receive/launch/cleanup、租户隔离、reaper/P0 receipt 与 DB 时间窗全部通过。
