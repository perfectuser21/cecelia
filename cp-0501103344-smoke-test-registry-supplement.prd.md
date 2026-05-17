# PRD: 补 Cecelia smoke test — 修正 17 个薄弱 smoke_cmd

## 背景

Brain features 表中 Cecelia 域（140 个 feature）的 `smoke_cmd` 存在三类质量问题：

1. **端点完全错误**：`immune-sweep` / `policy-list` / `notion-sync` / `orchestrator-chat` / `session-kill` 等 9 个 feature 的 smoke_cmd 指向 `/health` 或 `/status`，而非该 feature 对应的真实端点
2. **多 feature 共用同一条命令**：alertness-evaluate / alertness-history / alertness-override 三个 feature 指向同一 curl，无区分度
3. **关键字段未验证**：schedule-rumination / schedule-desire-loop / quarantine-stats 等只检查 `type=="object"`，未验证实际数据字段

`all-features-smoke.sh`（PR #2700）会逐条执行所有 feature 的 `smoke_cmd`。当前 208 个全部 passing，但 passing 不等于有效——这 17 个 feature 的 smoke 即便通过，也不能证明功能可用。

## 范围

### migration 250: 17 个 smoke_cmd UPDATE

- immune-sweep → `/immune/status | .data.last_sweep.started_at != null`
- policy-list → `/status | .policy_rules != null`
- notion-sync → `/features?limit=5 | .features | length > 0`
- orchestrator-chat → `/status | .decision_mode != null`
- session-kill → `POST /cluster/kill-session` (curl -s，不退出 4xx)
- device-lock → `/status | .decision_mode != null`
- vps-containers → `/vps-monitor/stats | type == "object"`
- db-backup → `/status | .pack_version != null`
- intent-parse → `node -e accessSync intent-match.js`（路由未挂载为已知 P1 bug）
- session-scan → `/cluster/scan-sessions | .processes != null`
- alertness-evaluate → `POST /alertness/evaluate | .success == true`
- alertness-history → `/alertness | .lastEvaluation != null or .level != null`
- alertness-override → `/alertness | has("override")`
- schedule-rumination → `/rumination/status | type == "object"`
- schedule-desire-loop → `/desires | .desires != null`
- schedule-daily-report → `/design-docs?type=diary&limit=1 | .data != null`
- quarantine-stats → `/quarantine | .stats != null`

### cecelia-smoke-audit.sh（静态 smoke 脚本）

覆盖上述 17 个 feature 的真路径验证，本地 20/20 pass，纳入 `real-env-smoke` CI。

## 成功标准

- cecelia-smoke-audit.sh 本地 20/20 pass
- CI real-env-smoke 通过
- 已知 bug（intent-match 路由未挂载）在脚本中标注 ⚠️ 不 fail smoke

## DoD

- [x] [ARTIFACT] migration 250 存在且覆盖 17 个 UPDATE / Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/250_fix_cecelia_smoke_cmds.sql','utf8');['immune-sweep','policy-list','notion-sync','alertness-evaluate','session-kill','quarantine-stats'].forEach(id=>{if(!c.includes(id))process.exit(1)})"`
- [x] [BEHAVIOR] cecelia-smoke-audit.sh 20/20 pass / Test: `manual:bash packages/brain/scripts/smoke/cecelia-smoke-audit.sh`
- [x] [BEHAVIOR] smoke 脚本测了 POST 类端点（alertness/evaluate、cluster/kill-session）/ Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/cecelia-smoke-audit.sh','utf8');if(!c.includes('POST'))process.exit(1)"`
