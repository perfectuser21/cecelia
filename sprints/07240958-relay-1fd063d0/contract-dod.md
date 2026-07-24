---
skeleton: false
journey_type: agent_remote
target_environment: local_api
---

# Contract DoD — 完整 Codex Slot 安全硬切换

**范围**：受控身份、durable broker/lease/session/audit、xian-m1/xian-m4 agent、固定 mmv、broker-only auth、旧入口硬切、stop/reaper、专用 fake-auth 双机 smoke。
**大小**：L
**状态纪律**：所有条目初始未勾；L3 真机条目在 final-e2e 前均为 `logic-done-pending`。

## ARTIFACT 条目

- [ ] [ARTIFACT] A01 Brain control plane 路由、broker、reaper 与路由接线存在
  Test: manual:bash -c 'node -e "const fs=require(\"node:fs\");const ps=[\"packages/brain/src/routes/codex-slots.js\",\"packages/brain/src/codex-slot-broker.js\",\"packages/brain/src/codex-slot-reaper.js\"];for(const p of ps){if(!fs.existsSync(p)){console.error(\"RED: missing \"+p);process.exit(1)}}const w=fs.readFileSync(\"packages/brain/src/routes.js\",\"utf8\");if(!w.includes(\"codex-slots\")||!w.includes(\"router.use\")){console.error(\"RED: route not wired\");process.exit(1)}"'
  期望: Node 解释器 exit 0；三个文件存在且 `/codex-slots` 已接线。

- [ ] [ARTIFACT] A02 migration 360 建立 tenant-scoped lease/session/identity/agent/rollout/audit schema 与 blocking lease 唯一索引
  Test: manual:bash -c 'node -e "const fs=require(\"node:fs\");const p=\"packages/brain/migrations/360_codex_slot.sql\";if(!fs.existsSync(p)){console.error(\"RED: missing \"+p);process.exit(1)}const s=fs.readFileSync(p,\"utf8\");for(const x of [\"tenant_id\",\"codex_slot_leases\",\"codex_slot_sessions\",\"codex_slot_actor_identities\",\"codex_slot_agents\",\"codex_slot_rollout\",\"codex_slot_audit_events\",\"codex_slot_one_blocking_lease_per_account\",\"quarantined\",\"blocked\"]){if(!s.includes(x)){console.error(\"RED: migration missing \"+x);process.exit(1)}}"'
  期望: Node 解释器 exit 0；所有 durable 对象和唯一索引字面存在。

- [ ] [ARTIFACT] A03 新 client/agent/installer 与旧入口脚本均通过 Bash/Node 语法闸
  Test: manual:bash -c '/bin/bash -n scripts/codex-request.sh scripts/codex-remote-launch.sh; bash -n scripts/codex-request.sh scripts/codex-remote-launch.sh; for p in scripts/codex-slot scripts/codex-slot-client.mjs scripts/codex-slot-agent.mjs scripts/install-codex-slot.sh; do [ -f "$p" ] || { echo "RED: missing $p" >&2; exit 1; }; done; /bin/bash -n scripts/codex-slot scripts/install-codex-slot.sh; bash -n scripts/codex-slot scripts/install-codex-slot.sh; /bin/bash scripts/install-codex-slot.sh --help >/dev/null; bash scripts/install-codex-slot.sh --help >/dev/null; node --check scripts/codex-slot-client.mjs; node --check scripts/codex-slot-agent.mjs'
  期望: macOS `/bin/bash` 3.2、现代 Bash 与 Node 均真实启动并 exit 0；installer 不依赖 Bash 4 专属语法且两套 `--help` 都可执行。

- [ ] [ARTIFACT] A04 root 配置样例和专用 fake auth fixture 存在，fixture 明示不可用于真实认证且不含真实 token 形态
  Test: manual:bash -c 'node -e "const fs=require(\"node:fs\");const cp=\"config/codex-slot/agents.example.json\";const fp=\"scripts/fixtures/codex-slot/fake-auth.json\";for(const p of [cp,fp]){if(!fs.existsSync(p)){console.error(\"RED: missing \"+p);process.exit(1)}}const c=JSON.parse(fs.readFileSync(cp,\"utf8\"));if(!Array.isArray(c.agents)||c.agents.length!==2||!c.agents.every(a=>a.agent_id&&a.mmv&&a.mmv.stable_node_id&&Array.isArray(a.mmv.allowed_ips))){process.exit(1)}const raw=fs.readFileSync(fp,\"utf8\");const f=JSON.parse(raw);if(f.fixture!==true||!/not.a.real.token/i.test(raw)||/sk-[A-Za-z0-9_-]{16,}/.test(raw)){process.exit(1)}"'
  期望: Node 解释器 exit 0；配置只给结构，不写死本次探针值；fixture 明示 fake。

- [ ] [ARTIFACT] A05 smoke、allowlist、scheduler-jobs、版本四件套与 DEFINITION 同步
  Test: manual:bash -c 'node -e "const fs=require(\"node:fs\");const smoke=\"packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh\";if(!fs.existsSync(smoke)){console.error(\"RED: missing smoke\");process.exit(1)}const allow=fs.readFileSync(\"packages/quality/smoke-allowlist.txt\",\"utf8\");if(!allow.includes(\"codex-slot-lifecycle-smoke.sh\")){process.exit(1)}const jobs=fs.readFileSync(\"packages/brain/src/scheduler-jobs.js\",\"utf8\");if(!jobs.includes(\"codex-slot-reaper\")){process.exit(1)}const pkg=JSON.parse(fs.readFileSync(\"packages/brain/package.json\",\"utf8\"));const def=fs.readFileSync(\"DEFINITION.md\",\"utf8\");const ledger=fs.readFileSync(\".brain-versions\",\"utf8\").trim().split(/\\n/).filter(Boolean).at(-1);if(pkg.version===\"1.267.61\"||!def.includes(pkg.version)||ledger!==pkg.version){process.exit(1)}"'
  期望: Node 解释器 exit 0；smoke 已登记；reaper 接 scheduler-jobs；Brain 版本已 bump 且四处一致。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B01 GP1 旧 token 入口只给 `codex-slot start` 迁移提示
  动作: 分别调用两个旧脚本的 `--help` 安全路径。
  预期观察: 输出只描述新入口，不再出现 team/scp/push/pull/collect 旧能力。
  验证命令: Test: manual:bash -c 'for p in scripts/codex-request.sh scripts/codex-remote-launch.sh; do O=$(bash "$p" --help); printf "%s\n" "$O" | grep -q "codex-slot start" || { echo "RED: migration hint missing in $p" >&2; exit 1; }; if printf "%s\n" "$O" | grep -Eq "\\bscp\\b|--team|--collect|拉取.*token|推送 token"; then echo "FAIL: legacy path still advertised in $p" >&2; exit 1; fi; done'
  期望: Bash 解释器 exit 0；不执行任何网络或 auth 操作。

- [ ] [BEHAVIOR] [L2] B02 GP1 新 client 拒绝 actor/team/host authority flags
  动作: 用 Node 真启动新 client，并传入三个禁止字段。
  预期观察: client 在发网络请求前 exit 64，并输出固定拒绝码。
  验证命令: Test: manual:bash -c 'set +e; O=$(node scripts/codex-slot-client.mjs start --actor forged --team team1 --host xian-m4 2>&1); R=$?; set -e; [ "$R" -eq 64 ] || { printf "%s\n" "$O" >&2; exit 1; }; printf "%s\n" "$O" | grep -q "authority flags are forbidden"'
  期望: Node 已真实启动；exit 64。

- [ ] [BEHAVIOR] [L2] B03 GP1 未认证 acquire 必须 fail closed，不允许通用 404 假绿
  动作: 不带 broker token，向真实 Brain 5221 POST acquire。
  预期观察: 返回 HTTP 401 与 exact error schema；404/200/500 均失败。
  验证命令: Test: manual:bash -c 'F=$(mktemp); C=$(curl -sS -o "$F" -w "%{http_code}" -X POST http://localhost:5221/api/brain/codex-slots/acquire -H "Content-Type: application/json" -H "Idempotency-Key: contract-unauth" -d "{\"project\":\"cecelia\",\"name\":\"main\"}"); [ "$C" = "401" ] || { echo "FAIL: expected 401 got $C" >&2; rm -f "$F"; exit 1; }; jq -e "keys == [\"error\",\"ok\"] and .ok == false and (.error | keys == [\"code\",\"message\",\"retryable\"]) and (.error.code | type == \"string\")" "$F"; R=$?; rm -f "$F"; exit "$R"'
  期望: curl/jq 均真实启动；HTTP 401，jq exit 0。

- [ ] [BEHAVIOR] [L2] B04 GP2 PostgreSQL 强制 tenant scope 与单账号 blocking lease 唯一
  动作: 查询真实 PostgreSQL 的 migration 结果和唯一索引定义。
  预期观察: within 5s 读到所有 tenant_id 列，且 partial unique index 覆盖 active/quarantined/blocked。
  验证命令: Test: manual:bash -c 'DB="${DB_URL:-postgresql://localhost/cecelia}"; S=$(date +%s); N=$(psql "$DB" -Atqc "SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('\''codex_slot_actor_identities'\'','\''codex_slot_leases'\'','\''codex_slot_sessions'\'','\''codex_slot_agents'\'','\''codex_slot_rollout'\'','\''codex_slot_audit_events'\'') AND column_name='\''tenant_id'\''"); [ "$N" -eq 6 ] || { echo "FAIL: tenant columns=$N" >&2; exit 1; }; I=$(psql "$DB" -Atqc "SELECT pg_get_indexdef(to_regclass('\''codex_slot_one_blocking_lease_per_account'\''))"); printf "%s\n" "$I" | grep -q "account_ref" && printf "%s\n" "$I" | grep -q "active" && printf "%s\n" "$I" | grep -q "quarantined" && printf "%s\n" "$I" | grep -q "blocked"; E=$(date +%s); [ $((E-S)) -lt 5 ]'
  期望: psql 真实连接；exit 0；耗时 <5s。

- [ ] [BEHAVIOR] [L2] B05 GP2 真实调用方 shape 幂等 acquire 返回 exact success schema
  动作: smoke 以受保护 Bearer/identity headers + `{project,name}` 触发两次同 Idempotency-Key acquire。
  预期观察: 两次得到同一 session/lease；返回不含 actor/team/account_ref/host/token/auth/prompt/env。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED: missing $S" >&2; exit 1; }; O=$("$S" --case durable-idempotent-acquire --json); printf "%s\n" "$O" | jq -e "keys == [\"ok\",\"session\"] and .ok == true and (.session | keys == [\"agent_id\",\"handle\",\"lease_id\",\"session_id\",\"status\"]) and .session.status == \"running\" and (has(\"actor\")|not) and (.session|has(\"team\")|not) and (.session|has(\"account_ref\")|not) and (.session|has(\"token\")|not) and (.session|has(\"auth\")|not)"'
  期望: Bash/smoke/jq 真执行；exact schema；重放无第二 lease。

- [ ] [BEHAVIOR] [L3] B06 GP3 xian-m1/xian-m4 真 agent 身份、容量、mmv stable ID/IP 全健康
  动作: 经真实 SSH 在两台目标机调用 root-owned agent health。
  预期观察: within 20s 两台均返回自身稳定 agent_id，容量明确可用，mmv online/stable ID/IP 对账为 true。
  验证命令: Test: manual:bash -c 'for H in xian-m1 xian-m4; do O=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$H" '\''test -x /usr/local/libexec/cecelia-codex-slot-agent || { echo "RED: agent not installed" >&2; exit 1; }; sudo -n /usr/local/libexec/cecelia-codex-slot-agent health --json'\''); printf "%s\n" "$O" | jq -e --arg h "$H" "keys==[\"agent\",\"ok\"] and .ok==true and (.agent|keys==[\"agent_id\",\"capacity\",\"identity_ok\",\"mmv\"]) and .agent.agent_id==\$h and .agent.identity_ok==true and (.agent.capacity|keys==[\"available\",\"known\"]) and .agent.capacity.known==true and .agent.capacity.available==true and (.agent.mmv|keys==[\"ip_allowlist_match\",\"online\",\"stable_node_id_match\"]) and .agent.mmv.online==true and .agent.mmv.stable_node_id_match==true and .agent.mmv.ip_allowlist_match==true" || exit 1; done'
  期望: 本地 Bash、SSH、远端 shell、agent、jq 均真执行；exit 0；当前为 `logic-done-pending`。

- [ ] [BEHAVIOR] [L3] B07 GP4 prepare 后 mmv 变化时 agent 不读不写 auth，正常投递只回摘要
  动作: smoke 在 protected receiver 上执行正常投递与 prepare→receive 竞态两支。
  预期观察: 竞态支 read_auth/wrote_auth=false；正常支 mode=600、secret_echoed=false；不确定 lease=quarantined。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED: missing $S" >&2; exit 1; }; O=$("$S" --case protected-delivery-race --json); printf "%s\n" "$O" | jq -e ".ok==true and .before_change.read_auth==false and .before_change.wrote_auth==false and .normal.mode==\"600\" and .normal.secret_echoed==false and .uncertain.lease_state==\"quarantined\""'
  期望: 真 broker/agent/FS 路径；exit 0；当前为 `logic-done-pending`。

- [ ] [BEHAVIOR] [L3] B08 GP5 launch 二次 mmv 失败必须清 auth/tmux/temp 且不释放 lease
  动作: smoke 在 receive 成功后改变 agent 可观测出口，再调用 launch。
  预期观察: launch 被拒；auth/tmux/temp 全 absent；lease 不是 released。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED: missing $S" >&2; exit 1; }; O=$("$S" --case launch-exit-node-race --json); printf "%s\n" "$O" | jq -e ".ok==true and .launch_rejected==true and .auth_absent==true and .tmux_absent==true and .temp_absent==true and .lease_state!=\"released\""'
  期望: 真 agent/FS/tmux 路径；exit 0；当前为 `logic-done-pending`。

- [ ] [BEHAVIOR] [L3] B09 GP6 stop 幂等返回 exact cleanup schema
  动作: 在专用 fake-auth session 上连续两次 stop 同一 handle。
  预期观察: 两次均为 stopped；auth/tmux/temp absent；lease released；不增加第二次释放事件。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED: missing $S" >&2; exit 1; }; O=$("$S" --case idempotent-stop --json); printf "%s\n" "$O" | jq -e "keys==[\"ok\",\"session\"] and .ok==true and (.session|keys==[\"cleanup\",\"handle\",\"session_id\",\"status\"]) and .session.status==\"stopped\" and (.session.cleanup|keys==[\"auth_absent\",\"lease_state\",\"temp_absent\",\"tmux_absent\"]) and .session.cleanup.auth_absent==true and .session.cleanup.tmux_absent==true and .session.cleanup.temp_absent==true and .session.cleanup.lease_state==\"released\""'
  期望: 真 agent/FS/tmux/DB 路径；exact schema；当前为 `logic-done-pending`。

- [ ] [BEHAVIOR] [L2] B10 GP6 reaper 两轮不重置状态，不可达租约保持 quarantine
  动作: 用真实 PostgreSQL 状态执行第一轮 reaper，等待时间流逝，再执行第二轮；另设精确 stopped receipt 对照。
  预期观察: within 30s 两轮不可达均 quarantined、released=0；精确 stopped 对照才 released；summary exact。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED: missing $S" >&2; exit 1; }; O=$("$S" --case reaper-two-pass --json); printf "%s\n" "$O" | jq -e ".ok==true and .first_pass.unreachable_state==\"quarantined\" and (.first_pass.response|keys==[\"ok\",\"summary\"]) and .first_pass.response.ok==true and (.first_pass.response.summary|keys==[\"checked\",\"heartbeat_updated\",\"quarantined\",\"released\"]) and .second_pass.unreachable_state==\"quarantined\" and .second_pass.response.summary.released==0 and .confirmed_stop.lease_state==\"released\""'
  期望: 真 PostgreSQL + 真 reaper；两轮之间不清库；exit 0。

- [ ] [BEHAVIOR] [L2] B11 GP2/GP6 两租户不串且近 5 分钟审计无 secret/prompt/full auth/env
  动作: smoke 种植两个 tenant，分别 acquire/stop，并查询真实 PostgreSQL。
  预期观察: 每 tenant 只见自己的 session；跨 tenant count=0；敏感字段 count=0。
  验证命令: Test: manual:bash -c 'S=packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh; [ -x "$S" ] || { echo "RED: missing $S" >&2; exit 1; }; O=$("$S" --case tenant-isolation-and-redaction --json); printf "%s\n" "$O" | jq -e ".ok==true and .tenant_a.own_count==1 and .tenant_a.cross_count==0 and .tenant_b.own_count==1 and .tenant_b.cross_count==0 and .audit_secret_rows==0 and .window_minutes==5"'
  期望: 真 PostgreSQL；两个 tenant；时间窗=5 分钟；exit 0。

## Invariant 逐条覆盖（53/53）

说明：适用项映射到本 DoD 的可执行 Bxx/Axx 或 contract-draft 的明确判定；不适用项逐条写明 N/A 理由，禁止静默省略。

| INV | 铁律 | 映射或显式 N/A |
|---|---|---|
| INV-01 | 合同批准前 manual oracle 真退出码/解释器启动 | 映射 proposer Red 证据与逐条命令实跑记录；所有 A/B 命令均记录 rc。 |
| INV-02 | JavaScript 模板插值 manual:node 真运行 | N/A：本合同无 `manual:node -e` JavaScript 模板插值；Node ARTIFACT 命令仍逐条真跑。 |
| INV-03 | smoke 铁律 | 映射 A05、B06-B11 与 E2E。 |
| INV-04 | smoke 铁律 | 映射 A05、B06-B11 与 E2E。 |
| INV-05 | 周期扫描不能只测冷启动 | 映射 B10：同一 DB 状态两轮 reaper + 时间流逝。 |
| INV-06 | 重扫付费调用需已处理检查 | N/A：reaper 不调用任何付费 API；OpenAI 真调用明确不在 smoke。 |
| INV-07 | 跨模块时间常数关系显式断言 | 映射八要素保质期、B10 within 30s；health sample TTL < heartbeat stale < reaper quarantine review TTL，值由 root 配置并由测试断言严格递增。 |
| INV-08 | 环境关键词不得 theater | 映射 target_environment=local_api + 接缝清单；B06-B09 真 SSH 两机。 |
| INV-09 | target_environment 以 payload 为准 | 映射 front matter 与 contract-draft E2E，固定读取 PRD payload 的 `local_api`。 |
| INV-10 | judge 含顶层/每项退出码与日志尾 | N/A：属 harness judge 输出协议，不由 Codex Slot 产品改动。 |
| INV-11 | 写受限字段前截断 | 映射输入对抗面；route/agent 对 message、handle、remote stderr 先定长截断再入库/日志。 |
| INV-12 | 复活退役功能前核代码与死因 | 映射已知约束与真实调用方 shape；已核 `origin/main` 旧入口及 lost-update 死因。 |
| INV-13 | null/false 失败显式处理 | 映射失败语义；身份、采样、SSH、receipt 任一 false/null 均 fail closed。 |
| INV-14 | smoke 铁律 | 映射 A05、B06-B11 与 E2E。 |
| INV-15 | journey feature 长期未更新报告探针 | N/A：本 sprint 不改 journey report 调度。 |
| INV-16 | merge 后 report 机械收口 | N/A：本 sprint 不改 harness merge/report 链。 |
| INV-17 | host 白名单核对 headed 接管 | N/A：无 headed session/人工接管通道；agent forced-command 不提供 shell。 |
| INV-18 | headed relay payload 含 base repo/PR | N/A：本功能不点火 headed relay。 |
| INV-19 | 退役需生产数据/消费者证据 | 映射真实调用方 shape、旧入口 help B01；退役对象与消费者已从 `origin/main` 核对。 |
| INV-20 | 吞错后台任务失败计数/连续告警 | 映射八要素死亡告警；reaper 必须暴露连续失败计数并 P0/Bark。 |
| INV-21 | 建表前核全部写入方 | 映射 A02/禁 mock 边；`codex_slot_*` 仅 broker/reaper 写，agent 不直写 DB。 |
| INV-22 | 后台落库声明真实消费者 | 映射八要素效果确认；sessions/leases 由 acquire/status/stop/reaper 消费，audit 由安全审计消费。 |
| INV-23 | 多设备类型检查 UI 区分 | N/A：无 UI；xian-m1/xian-m4 以 agent_id 区分并由 B06/E2E 验收。 |
| INV-24 | 判变端与终验端语义一致 | 映射 Step 3/5 与判定表；prepare/launch 使用同一 mmv stable ID/IP 判定函数。 |
| INV-25 | git ref 用 rev-parse verify | N/A：PRD 未要求创建/判断 git ref 或 worktree。 |
| INV-26 | 真实 worktree smoke 不碰生产 | N/A：本 sprint fake-auth smoke 不创建 git worktree；只使用专用 session 临时根。 |
| INV-27 | 部署失败非 warning | 映射 A03/A05、失败语义；installer/agent/launchd 安装任一步非零即失败。 |
| INV-28 | 判变以生产自报对账 origin/main | N/A：本功能不做代码版本判变；主机状态来自真 agent 自报并对 root 配置。 |
| INV-29 | 异步质量测试经异步函数调用 | 映射 product tests 要求：broker/reaper async 接口必须被 await 真调用；本 sprint Red tests 不假装源码 grep 为异步行为。 |
| INV-30 | Test Contract 固定四列/路径反引号/第三列解析 | 映射 contract-draft `## Test Contract`，严格四列且路径反引号。 |
| INV-31 | Red commit 精确暂存 | 映射交付流程：只 stage 本 sprint contract/tests/task-plan，禁止 `.harness`/`git add .`。 |
| INV-32 | 调度接线优先源码检查非仅 mock | 映射 A05 scheduler-jobs 静态接线 + B10 真 reaper/DB。 |
| INV-33 | cron 先查 scheduler-jobs，tick-runner 已弃用 | 映射 A05；reaper 只接 `scheduler-jobs.js`。 |
| INV-34 | generator 不自行 merge | 映射交付流程：只 push proposer/generator branch，由 controller 合并。 |
| INV-35 | headed tmux env 显式传 | N/A：无 headed relay/tmux 子 shell；agent launcher 所需非秘密上下文由 root metadata 文件读取。 |
| INV-36 | 复用历史模板前核真实派发历史 | 映射 Notes/已知约束；旧 PR 只研究，合同从本 PRD/main 重写。 |
| INV-37 | 共享 CI 基础设施默认禁改 | 映射 task-plan：不修改 `.github/workflows/ci.yml`；仅登记现有 smoke allowlist。 |
| INV-38 | merge 检查以 PR head SHA 对齐 verdict | N/A：属 controller pre-merge 流程，不由本产品实现。 |
| INV-39 | smoke 铁律 | 映射 A05、B06-B11 与 E2E。 |
| INV-40 | brain/src PR 带 smoke/allowlist | 映射 A05。 |
| INV-41 | 新 task type 全接线 | N/A：不新增 Brain task_type；reaper 是 scheduler job，走 INV-33。 |
| INV-42 | 服务存活同时查 launchctl/端口 | N/A：agent 为 SSH forced-command 按需进程，不新增监听端口或常驻服务。 |
| INV-43 | 美国 Mac 常驻服务用 LaunchDaemon | N/A：不新增美国 Mac 常驻服务。 |
| INV-44 | 新常驻宿主服务加入 launchd-patrol | N/A：不新增常驻宿主服务。 |
| INV-45 | smoke 铁律 | 映射 A05、B06-B11 与 E2E。 |
| INV-46 | 单槽串行 | 映射 A02/B04/B05；blocking lease 唯一索引 + session/account 锁。 |
| INV-47 | 环境值从环境/root 配置推导 | 映射 A04、B06、判定表；stable ID/IP/容量阈值不写死。 |
| INV-48 | 真机/生产/真实调用方未真验不得 done | 映射接缝清单；B06-B09/E2E 前均 `logic-done-pending`。 |
| INV-49 | 默认两个 tenant 且不串 | 映射 B11/E2E。 |
| INV-50 | secrets 不硬编码/不进 git/log | 映射 A04、B07/B11、未覆盖清单；仅专用 fake fixture。 |
| INV-51 | PII/聊天内容不明文日志 | 映射 B11/输入对抗面；不记录 prompt/full env，actor 仅存受控内部 ID。 |
| INV-52 | 每 API 端点鉴权 | 映射 A01/B03/真实调用方 shape；Bearer 未配置也 fail closed。 |
| INV-53 | tenant 查询/写入全 scope | 映射 A02/B04/B11/E2E；所有 `codex_slot_*` 行和查询含 tenant_id。 |

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api 控制面 + xian-m1/xian-m4 专用 fake-auth 完整生命周期
  执行体: `contract-draft.md` 的单一 `## E2E 验收` bash 块。
  期望: 两台真机分别完成 acquire→prepare→receive→launch fixture process→stop→cleanup；两 tenant 不串；DB/agent 无残留。
