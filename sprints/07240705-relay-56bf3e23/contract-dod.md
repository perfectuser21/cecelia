---
skeleton: false
journey_type: agent_remote
target_environment: local_api
harness_gear: segmented
---

# Contract DoD — Codex Slot 安全硬切换

**范围**：从 main 独立实现完整 broker-only Codex Slot 安全生命周期。

**大小**：L，按 ws1→ws8 串行交付；每个 ws 未完成其 DoD 不得启动后继。

**done 语义**：逻辑测试通过但 xian-m1/xian-m4 接缝未留证时只能是 `logic-done-pending`；双真机 smoke 与零残留全部通过后才是 done。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 定义 company account、lease、session、audit、rollout durable schema 与单账号阻塞租约唯一约束。
  Test: node -e "const fs=require('fs');const p=fs.readdirSync('packages/brain/migrations').find(x=>x.includes('codex_slot'));if(!p)process.exit(1);const s=fs.readFileSync('packages/brain/migrations/'+p,'utf8');for(const k of ['codex_company_accounts','codex_account_leases','codex_slot_sessions','codex_slot_audit','broker_only'])if(!s.includes(k))process.exit(1)"

- [ ] [ARTIFACT] root 配置 schema 明确 actors、xian-m1/xian-m4、max_slots、固定 SSH config 与 `mmv` 信任根，且不写死实际 stable node ID/IP。
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('packages/brain/src/codex-slot/config.js','utf8');for(const k of ['xian-m1','xian-m4','max_slots','stable_node_id','allowed_ip'])if(!s.includes(k))process.exit(1);if(/38\\.23\\.47\\.81/.test(s))process.exit(1)"

- [ ] [ARTIFACT] client、broker CLI、agent、registry、reaper、rollout 模块均存在且普通输出禁含秘密字段。
  Test: node -e "const fs=require('fs');for(const p of ['scripts/codex-slot-client.sh','packages/brain/src/codex-slot/cli.js','packages/brain/src/codex-slot/agent.js','packages/brain/src/codex-slot/registry.js','packages/brain/src/codex-slot/reaper.js','packages/brain/src/codex-slot/rollout.js'])fs.accessSync(p)"

- [ ] [ARTIFACT] 旧 `codex-request.sh` 与 `codex-remote-launch.sh` 不再含直接 scp auth/token 投递路径，只允许硬失败或转交 broker。
  Test: node -e "const fs=require('fs');for(const p of ['scripts/codex-request.sh','scripts/codex-remote-launch.sh']){const s=fs.readFileSync(p,'utf8');if(/scp[\\s\\S]{0,160}auth\\.json/.test(s))process.exit(1);if(!/broker|已禁用|disabled/i.test(s))process.exit(1)}"

- [ ] [ARTIFACT] `scheduler-jobs.js:JOBS` 注册 codex-slot-reaper；未接到 deprecated tick runner。
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('packages/brain/src/scheduler-jobs.js','utf8');if(!s.includes('codex-slot-reaper'))process.exit(1)"

- [ ] [ARTIFACT] 安装/运维资产覆盖 broker/client、xian agent forced-command、root config 权限、Bash 3.2/现代 Bash 与 launchd patrol 适用性声明。
  Test: node -e "const fs=require('fs');const p='packages/brain/scripts/install-codex-slot.sh';const s=fs.readFileSync(p,'utf8');for(const k of ['forced-command','0600','xian-m1','xian-m4','Bash 3.2'])if(!s.includes(k))process.exit(1)"

- [ ] [ARTIFACT] 独立 security smoke、双主机 smoke 与 CI allowlist/登记同一提交交付；共享 workflow 不在授权范围。
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/scripts/smoke/codex-slot-security-smoke.sh','packages/brain/scripts/smoke/codex-slot-host-smoke.sh','packages/quality/smoke-allowlist.txt'])fs.accessSync(p)"

- [ ] [ARTIFACT] 根 `DEFINITION.md` 与 Brain 版本按仓库规则更新。
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('DEFINITION.md','utf8');if(!/Codex Slot|codex slot/i.test(s))process.exit(1);fs.accessSync('packages/brain/VERSION')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] BEH-01 受控 SSH key/UID 映射 actor，客户端 actor/host/env 伪造无效。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts -t "受控 SSH key 映射 actor 且忽略客户端 actor/host 自报|无 UID/SSH key 映射时 fail closed" --reporter=verbose'
  期望：2 tests pass，exit 0。

- [ ] [BEHAVIOR] BEH-02 自动选择仅接纳身份、出口、容量和新鲜度全有效的 xian slot。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-identity-routing.contract.test.ts -t "自动选择仅接纳身份、mmv、容量与新鲜度全部有效的 agent slot|容量缺失、零容量或过期时不选择任何 agent" --reporter=verbose'
  期望：2 tests pass，exit 0。

- [ ] [BEHAVIOR] BEH-03 真 Postgres durable acquire 保证单账号单阻塞租约且 request_id 幂等。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t "durable acquire 对同一公司账号只产生一个 blocking lease|相同 idempotency key 重放返回同一 session handle" --reporter=verbose'
  期望：2 tests pass，重复阻塞租约 0。

- [ ] [BEHAVIOR] BEH-04 两台 agent 真 SSH prepare 均从 root 配置自证身份、持锁并创建 0700 私有目录。
  Test: manual:bash -lc 'for HOST in xian-m1 xian-m4; do RESP=$(ssh -F /etc/cecelia/codex-slot/ssh_config "codex-slot@${HOST}" codex-slot-agent prepare-smoke); echo "$RESP" | jq -e --arg host "$HOST" '"'"'.ok == true and .operation == "prepare" and .agent_id == $host and .lock_held == true and .private_mode == "0700"'"'"'; done'
  期望：两台均 exit 0，禁止 host 自报 fallback。

- [ ] [BEHAVIOR] BEH-05 broker 经固定 SSH/stdin 投递限长 snapshot，nonce 单次消费且日志不含 auth。
  Test: manual:bash -lc 'for HOST in xian-m1 xian-m4; do OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --phase deliver-only); echo "$OUT" | jq -e --arg host "$HOST" '"'"'.ok == true and .agent_id == $host and .stdin_delivery == true and .nonce_consumed == true and .auth_logged == false and .mmv_verified == true'"'"'; done'
  期望：两台均 exit 0，auth 只走 stdin。

- [ ] [BEHAVIOR] BEH-06 agent 仅在两次实时 `mmv` 全校验通过后 durable 0600 写 auth 并 launch；坏出口删除暂存且零 tmux。
  Test: manual:bash -lc 'for HOST in xian-m1 xian-m4; do OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --phase launch-fail-closed); echo "$OUT" | jq -e --arg host "$HOST" '"'"'.ok == true and .agent_id == $host and .auth_mode == "0600" and .durable_write == true and .mmv_checks == 2 and .bad_exit_rejected == true and .bad_exit_auth_removed == true and .bad_exit_tmux_created == false'"'"'; done'
  期望：两台均 exit 0，`mmv_checks=2`。

- [ ] [BEHAVIOR] BEH-07 SSH 未知结果 quarantine；broker 重建后按 handle 精确 readback，不自行 release。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t "未知投递结果只 quarantine|durable store 重建实例后仍可按 session handle readback" --reporter=verbose'
  期望：2 tests pass，未知结果状态为 quarantined。

- [ ] [BEHAVIOR] BEH-08 reaper 真 registry/PG 连续两轮且时间真实流逝，quarantine 不振荡；JOBS 周期 60 秒。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "reaper 两轮真实时间流逝不重置状态|scheduler JOBS 真实接线" --reporter=verbose'
  期望：2 tests pass，intervalMs=60000。

- [ ] [BEHAVIOR] BEH-09 rollout 禁止越级到 broker_only，必须先 inventory_complete + legacy 禁写探针。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "rollout 在 inventory_complete 与旧入口禁写证据前拒绝 broker_only" --reporter=verbose'
  期望：1 test pass，越级 transition 被拒。

- [ ] [BEHAVIOR] BEH-10 旧 codex-request 入口真执行非零退出，且隔离 HOME 中零 auth 写入。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "旧 codex-request 入口硬失败且不创建 auth.json" --reporter=verbose'
  期望：1 test pass；旧入口无第二 issuer。

- [ ] [BEHAVIOR] BEH-11 xian-m1/xian-m4 各用专用非秘密 fixture 跑真 SSH/stdin/tmux/worktree 全生命周期并零残留。
  Test: manual:bash -lc 'START=$(date +%s); for HOST in xian-m1 xian-m4; do OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --full); echo "$OUT" | jq -e --arg host "$HOST" --argjson start "$START" '"'"'.ok == true and .agent_id == $host and .fixture_is_secret == false and .lifecycle == ["prepared","auth_accepted","running","stopped","released"] and .residue_count == 0 and .finished_at_epoch >= $start'"'"'; done'
  期望：两台均 exit 0、完整状态序列、residue_count=0。

- [ ] [BEHAVIOR] BEH-12 security smoke 覆盖伪造身份、坏 host/容量/`mmv`、未知 SSH、durable 故障和秘密扫描。
  Test: manual:bash -lc 'OUT=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh); echo "$OUT" | jq -e '"'"'.ok == true and .actor_spoof_rejected == true and .host_spoof_rejected == true and .missing_capacity_rejected == true and .bad_mmv_rejected == true and .unknown_ssh_quarantined == true and .durable_faults_rejected == true and .secret_hits == 0 and .duplicate_blocking_leases == 0'"'"''
  期望：所有布尔值 true、两个计数为 0。

## Invariant 约束逐条映射

- [ ] [BEHAVIOR] INV-01 冒烟铁律：全量 security smoke 必须真执行。
  Test: manual:bash -lc 'bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh | jq -e ".ok == true"'
- INV-02 — N/A：与 INV-01 完全重复的“冒烟铁律”，由 INV-01 单一 oracle 覆盖，避免重复执行。
- [ ] [BEHAVIOR] INV-03 reaper 必须真实多轮、状态不重置且时间真实流逝。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "reaper 两轮真实时间流逝不重置状态" --reporter=verbose'
- INV-04 — N/A：本 reaper 不调用 LLM/付费第三方 API，只调用自有 agent status。
- [ ] [BEHAVIOR] INV-05 跨模块时间关系显式满足 `0 < sample freshness <= reaper interval = 60000`。
  Test: manual:bash -lc 'node -e "Promise.all([import(\"./packages/brain/src/codex-slot/config.js\"),import(\"./packages/brain/src/codex-slot/reaper.js\")]).then(([c,r])=>{if(!(c.MMV_FRESHNESS_MS>0&&c.CAPACITY_FRESHNESS_MS>0&&c.MMV_FRESHNESS_MS<=r.REAPER_INTERVAL_MS&&c.CAPACITY_FRESHNESS_MS<=r.REAPER_INTERVAL_MS&&r.REAPER_INTERVAL_MS===60000))process.exit(1)})"'
- INV-06 — N/A：PRD/合同不含 Android ability，target_environment 按 payload 固定 local_api。
- INV-07 — N/A：本功能不 POST harness task；orchestrator payload 路由由上游 controller 负责。
- INV-08 — N/A：本功能不调用 Brain judge API。
- INV-09 — N/A：repo/worktree/session handle 使用 TEXT/UUID/受控 hash，不引入无截断 varchar 路径字段。
- INV-10 — N/A：合同阶段已执行 deleted-history 审查，未发现可复活的 Codex Slot broker 代码。
- [ ] [BEHAVIOR] INV-11 返回 null/false 的失败分支不可吞；security smoke 必须证明 durable 故障被拒。
  Test: manual:bash -lc 'OUT=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh); echo "$OUT" | jq -e ".durable_faults_rejected == true"'
- INV-12 — N/A：与 INV-01 重复的“冒烟铁律”。
- INV-13 — N/A：本 Sprint 不改 journey_features/report pipeline。
- INV-14 — N/A：本 Sprint 不改 harness-controller finalize/report。
- [ ] [BEHAVIOR] INV-15 host/环境白名单同时覆盖 headed 人工 client 与 headless，无 tty 放宽。
  Test: manual:bash -lc 'OUT=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh --headed-and-headless); echo "$OUT" | jq -e ".headed_identity_same == true and .headless_identity_same == true and .tty_bypass == false"'
- INV-16 — N/A：不点火 headed relay，不涉及 base_repo/pr_url。
- [ ] [BEHAVIOR] INV-17 rollout 退役旧入口以 inventory 与真禁写探针为证，不靠记忆。
  Test: manual:bash -lc 'OUT=$(node packages/brain/src/codex-slot/cli.js rollout-status); echo "$OUT" | jq -e ".inventory_complete == true and .legacy_write_probe_passed == true"'
- [ ] [BEHAVIOR] INV-18 reaper 失败必须进入 scheduler sentinel/失败计数，不静默吞错。
  Test: manual:bash -lc 'OUT=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh --reaper-failure); echo "$OUT" | jq -e ".reaper_failure_count >= 1 and .sentinel_ok == false and .alert_emitted == true"'
- INV-19 — N/A：新表使用独有 `codex_slot_*` 命名；ARTIFACT 要求 migration schema 单一写入边审查。
- [ ] [BEHAVIOR] INV-20 新 reaper 有真实消费者：它更新 lease/session，client status 可 readback。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts -t "durable store 重建实例后仍可按 session handle readback" --reporter=verbose'
- INV-21 — N/A：无 UI/展示字段；xian-m1/xian-m4 由同一 CLI schema 区分 agent_id。
- [ ] [BEHAVIOR] INV-22 broker、reaper 与 final E2E 对 unknown 语义一致为 quarantine。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-lifecycle.integration.contract.test.ts sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "unknown|未知|quarantine" --reporter=verbose'
- [ ] [BEHAVIOR] INV-23 worktree ref 判定使用 `git rev-parse --verify <ref>^{commit}`，真机 smoke 报 ref_verified。
  Test: manual:bash -lc 'for HOST in xian-m1 xian-m4; do OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --phase prepare-only); echo "$OUT" | jq -e ".ref_verified == true"; done'
- [ ] [BEHAVIOR] INV-24 host smoke 使用专用 sandbox 根且结束零残留，不触碰生产 auth/worktree。
  Test: manual:bash -lc 'for HOST in xian-m1 xian-m4; do OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --full); echo "$OUT" | jq -e ".production_paths_touched == false and .residue_count == 0"; done'
- [ ] [BEHAVIOR] INV-25 安装/部署失败非零并告警，不 warning 降级。
  Test: manual:bash -lc 'OUT=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh --install-failure); echo "$OUT" | jq -e ".install_exit_code != 0 and .alert_emitted == true and .warning_only == false"'
- INV-26 — N/A：本 Sprint 不实现部署判变，不以 worktree diff 判断生产版本。
- [ ] [BEHAVIOR] INV-27 合同 tests 通过 lint-test-quality，异步用例真实 await 被测函数。
  Test: manual:bash -lc 'node packages/engine/scripts/devgate/check-test-coverage.cjs'
- INV-28 — N/A：Test Contract 已按固定 4 列、第三列反引号 test path 写入 contract-draft.md，属 ARTIFACT 约束。
- INV-29 — N/A：proposer 合同 commit 按 harness skill 同时交付合同与 Red tests；Generator 后续新增 Red 测试时仍须精确 git add，禁止 `.harness/`。
- [ ] [BEHAVIOR] INV-30 回归测试直调真实模块/PG/SSH/tmux，被改边零 vi.mock/stub。
  Test: manual:bash -lc 'if rg -n "vi\\.mock|jest\\.mock|stub|mockResolvedValue" sprints/07240705-relay-56bf3e23/tests; then exit 1; fi'
- [ ] [BEHAVIOR] INV-31 reaper 只在 scheduler-jobs.js:JOBS 接线。
  Test: manual:bash -lc 'DB_URL="${DB_URL:-postgresql://localhost/cecelia}" npx vitest run sprints/07240705-relay-56bf3e23/tests/codex-slot-reaper-rollout.integration.contract.test.ts -t "scheduler JOBS 真实接线" --reporter=verbose'
- INV-32 — N/A：merge 权仍归 controller；task-plan 不含 merge 行为。
- INV-33 — N/A：本功能不由 headed relay tmux innerCmd 传 harness 上下文。
- INV-34 — N/A：合同未复用历史 dispatch 断言；按当前 PRD 与当前生产入口重新推导。
- INV-35 — N/A：共享 workflow 明确不在范围；仅授权新 smoke 对 `packages/quality/smoke-allowlist.txt` 作最小登记。
- INV-36 — N/A：PR 提前合并防护属于 controller，不是 Codex Slot 产品路径。
- INV-37 — N/A：与 INV-01 重复的“冒烟铁律”。
- [ ] [BEHAVIOR] INV-38 Brain 改动带独立 smoke 与 allowlist 登记。
  Test: manual:bash -lc 'node -e "const fs=require(\"fs\");for(const p of [\"packages/brain/scripts/smoke/codex-slot-security-smoke.sh\",\"packages/brain/scripts/smoke/codex-slot-host-smoke.sh\",\"packages/quality/smoke-allowlist.txt\"])fs.accessSync(p)"'
- INV-39 — N/A：不新增 task_type。
- INV-40 — N/A：不新增常驻网络服务；agent 是 SSH forced-command，reaper 运行于既有 Brain scheduler。
- INV-41 — N/A：美国本机不新增 LaunchAgent/LaunchDaemon。
- INV-42 — N/A：不新增常驻宿主服务；无需 launchd-patrol manifest 条目。
- INV-43 — N/A：与 INV-01 重复的“冒烟铁律”。
- [ ] [BEHAVIOR] INV-44 task-plan 单 slot 串行：仅 ws1 无依赖，ws2+ 各依赖直接前序。
  Test: manual:bash -lc 'node -e "const p=require(\"./sprints/07240705-relay-56bf3e23/task-plan.json\");if(!p.tasks.length)process.exit(1);p.tasks.forEach((t,i)=>{const want=i===0?[]:[p.tasks[i-1].task_id];if(JSON.stringify(t.depends_on)!==JSON.stringify(want))process.exit(1)})"'
- [ ] [BEHAVIOR] INV-45 `mmv` trust values 从 root 配置读取，两台真机实时校准，无硬编码 fallback。
  Test: manual:bash -lc 'for HOST in xian-m1 xian-m4; do OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --phase mmv-only); echo "$OUT" | jq -e ".trust_source == \"root_config\" and .mmv_verified == true and .fallback_used == false"; done'
- [ ] [BEHAVIOR] INV-46 接缝仅在 xian-m1/xian-m4 真目标通过后 done。
  Test: manual:bash -lc 'START=$(date +%s); for HOST in xian-m1 xian-m4; do OUT=$(bash packages/brain/scripts/smoke/codex-slot-host-smoke.sh "$HOST" --full); echo "$OUT" | jq -e --argjson start "$START" ".ok == true and .finished_at_epoch >= \$start and .residue_count == 0"; done'
- INV-47 — N/A：本功能不读写 tenant 数据；actor/account lease 不使用 tenant_id，禁止伪造“租户”测试替代身份隔离。
- [ ] [BEHAVIOR] INV-48 secrets 不硬编码、不进 git、不进日志。
  Test: manual:bash -lc 'OUT=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh); echo "$OUT" | jq -e ".secret_hits == 0 and .committed_auth_fixtures == 0"'
- [ ] [BEHAVIOR] INV-49 日志/审计不含 PII、prompt、完整 auth 或完整环境。
  Test: manual:bash -lc 'OUT=$(bash packages/brain/scripts/smoke/codex-slot-security-smoke.sh); echo "$OUT" | jq -e ".pii_hits == 0 and .prompt_hits == 0 and .environment_hits == 0"'
- INV-50 — N/A：不新增 HTTP API；client→broker 认证为受控 SSH/UID，已由 BEH-01 验证。
- INV-51 — N/A：不触碰 tenant 数据表或 tenant-scoped 查询。

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api evaluator 编排真 Postgres，并通过固定 SSH config 分别派发 xian-m1/xian-m4 假 token smoke。
  Test: contract-draft.md 的 `## E2E 验收` 单一 bash 块。
  期望：脚本 exit 0，双机 lifecycle 完整，审计新鲜，秘密/重复 lease/残留均为 0。
