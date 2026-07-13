---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: codex relay 有头 tmux 派发最小验证片

**范围**: packages/brain/src/harness-skill-relay.js（mode=headed 分支）+ harness-relay-watchdog.js（headed tmux 存活检测 + 收窗幂等）+ routes/tasks.js（mode 白名单 + claude+headed→400）+ initiative_runs（tmux_killed_at 字段）
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] harness-skill-relay.js 含 mode=headed 分支逻辑（ssh+tmux，不走 docker）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if(!c.includes('headed'))process.exit(1);if(!c.includes('tmux'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] harness-relay-watchdog.js 含 headed tmux has-session 检测 + fail-open + 收窗幂等
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-relay-watchdog.js','utf8');if(!c.includes('tmux has-session'))process.exit(1);if(!c.includes('tmux_killed_at'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] routes/tasks.js 含 mode 白名单校验（含 claude+headed→400 拒绝逻辑）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!c.includes('headed'))process.exit(1);if(!c.includes('claude'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] tests/headed-dispatch.test.js 存在且含 headed/headless/claude+headed 三类测试
  Test: node -e "const c=require('fs').readFileSync('sprints/07071654-codex-headed-dispatch/tests/headed-dispatch.test.js','utf8');if(!c.includes('headed'))process.exit(1);if(!c.includes('claude'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] tests/headed-watchdog.test.js 存在且含 fail-open 和 幂等 测试
  Test: node -e "const c=require('fs').readFileSync('sprints/07071654-codex-headed-dispatch/tests/headed-watchdog.test.js','utf8');if(!c.includes('fail-open')||!c.includes('幂等'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] headed spawn 后 tui.log 存在于 sprint 目录
  Test: node -e "const fs=require('fs');if(!fs.existsSync('sprints/07071654-codex-headed-dispatch/tui.log'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] packages/brain/migrations/316_initiative_runs_tmux_killed_at.sql 存在（为 initiative_runs 表添加 tmux_killed_at 字段）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/316_initiative_runs_tmux_killed_at.sql','utf8');if(!c.includes('tmux_killed_at'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，journey_type=autonomous）

### BEHAVIOR 1: mode=headed+codex 任务创建成功，claude+headed 返 400

- [ ] [BEHAVIOR] POST tasks(executor=codex, mode=headed) → HTTP 200 + 返回 id 字段
  Test: manual:bash -c 'RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"dod-headed-smoke\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headed\"}}"); echo "$RESP" | jq -e ".id | type == \"string\"" || { echo "FAIL: 任务创建失败"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST tasks(executor=claude, mode=headed) → HTTP 400 拒绝（claude 不支持有头模式）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"bad-combo\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"claude\",\"mode\":\"headed\"}}"); [ "$CODE" = "400" ] || { echo "FAIL: claude+headed 应 400，实际 $CODE"; exit 1; }; echo OK'
  期望: OK

### BEHAVIOR 2: headed spawn 走 ssh+tmux 路径，initiative_runs 落行 orchestrator_host='skill-relay-codex-headed'

- [ ] [BEHAVIOR] headed 任务被 tick 处理后，initiative_runs 写入 orchestrator_host='skill-relay-codex-headed'（带时间窗防造假）
  Test: manual:bash /workspace/sprints/07071654-codex-headed-dispatch/verify/behavior2-runs-check.sh
  期望: OK

### BEHAVIOR 3: headless/缺省路径零回归（不走 headed 分支）

- [ ] [BEHAVIOR] POST tasks(executor=codex, 无 mode 字段) → initiative_runs.orchestrator_host ≠ 'skill-relay-codex-headed'（现有 docker 路径不受影响）
  Test: manual:bash /workspace/sprints/07071654-codex-headed-dispatch/verify/behavior3-headless-regression.sh
  期望: headless 零回归 OK

### BEHAVIOR 4: watchdog headed 分支 ssh 失败时 fail-open（不触发重点火）

- [ ] [BEHAVIOR] watchdog 对 headed run 执行 ssh tmux has-session 时，若 ssh 命令本身报错，fail-open 不重点火（initiative_runs phase 不变为 A_planning）
  注：watchdog fail-open 是 ssh 层接缝，真实验证只能靠单测注入。本 BEHAVIOR 通过单测结果验收。
  Test: manual:bash -c 'node --experimental-vm-modules node_modules/.bin/vitest run sprints/07071654-codex-headed-dispatch/tests/headed-watchdog.test.js --reporter=verbose 2>&1 | grep -q "fail-open" && echo OK || { echo FAIL; exit 1; }'
  期望: OK（vitest 输出含 fail-open 用例通过标记）

### BEHAVIOR 5: 收窗幂等 — run 终态后 tmux_killed_at 写入，二次 watchdog 不重复 kill

- [ ] [BEHAVIOR] initiative_runs phase=done 且 completed_at > 30min 后，watchdog 写入 tmux_killed_at（带 5 分钟时间窗，防历史数据冒充）；再次执行 watchdog 不产生第二条 tmux_kill 记录
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; RESP=$(curl -sf -X POST http://localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"task_type\":\"harness_initiative\",\"title\":\"kill-idempotent-test\",\"payload\":{\"orchestrator\":\"skill-relay\",\"executor\":\"codex\",\"mode\":\"headed\"}}"); TASK_ID=$(echo "$RESP" | jq -r ".id"); sleep 2; psql "$DB" -c "UPDATE initiative_runs SET phase='"'"'done'"'"', completed_at=NOW() - interval '"'"'31 minutes'"'"' WHERE initiative_id='"'"'${TASK_ID}'"'"' AND orchestrator_version='"'"'v2'"'"'"; curl -sf -X POST http://localhost:5221/api/brain/tick/watchdog 2>/dev/null || true; sleep 5; CNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='"'"'${TASK_ID}'"'"' AND tmux_killed_at IS NOT NULL AND tmux_killed_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "${CNT}" -ge 1 ] || { echo "FAIL: tmux_killed_at 未写入"; exit 1; }; curl -sf -X POST http://localhost:5221/api/brain/tick/watchdog 2>/dev/null || true; sleep 2; CNT2=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE initiative_id='"'"'${TASK_ID}'"'"' AND tmux_killed_at IS NOT NULL" | tr -d " "); [ "${CNT2}" -le "1" ] || { echo "FAIL: 幂等失败，kill_count=$CNT2"; exit 1; }; echo OK'
  期望: OK

### BEHAVIOR 5b: tui.log 留痕 — headed spawn 后日志文件存在

- [ ] [BEHAVIOR] headed spawn 执行后，sprint 目录下 tui.log 文件存在
  Test: manual:bash -c '[ -f "sprints/07071654-codex-headed-dispatch/tui.log" ] && echo OK || { echo "FAIL: tui.log 不存在"; exit 1; }'
  期望: OK

### BEHAVIOR 5c: tui.log 管道洗敏 — 不含 GitHub 凭据明文

- [ ] [BEHAVIOR] tui.log 不含 GITHUB_TOKEN/github_pat_/ghp_ 明文（凭据安全 Invariant）
  Test: manual:bash -c '[ -f "sprints/07071654-codex-headed-dispatch/tui.log" ] && ! grep -qE "GITHUB_TOKEN=|github_pat_|ghp_[A-Za-z0-9]+" sprints/07071654-codex-headed-dispatch/tui.log && echo OK || { echo "FAIL: tui.log 不存在或含敏感信息"; exit 1; }'
  期望: OK

### BEHAVIOR 6: MAX=1 并发守门 — headed run 计入同一上限，防双 spawn

- [ ] [BEHAVIOR] 若已有活跃 headed run（initiative_runs phase=A_planning orchestrator_host=skill-relay-codex-headed），新 headed 任务 tick 时不重复 spawn（skip 或 defer）
  Test: manual:bash -c 'DB="${DB:-postgresql://localhost/cecelia}"; CNT=$(psql "$DB" -t -c "SELECT COUNT(*) FROM initiative_runs WHERE phase='"'"'A_planning'"'"' AND orchestrator_host='"'"'skill-relay-codex-headed'"'"'" | tr -d " "); echo "活跃 headed run 数=$CNT（期望 <=1）"; [ "${CNT}" -le "1" ] || { echo "FAIL: 并发守门失效，active_headed=$CNT"; exit 1; }; echo OK'
  期望: OK

---

## 接缝清单（真目标验证点）

| 接缝 | 真实世界碰触点 | 验证方式 | 状态 |
|---|---|---|---|
| ssh 逃逸到宿主 | `ssh <host> tmux new-session` 真实 SSH 命令 | 宿主上 `tmux has-session` exit 0 | logic-done-pending（需真机验证）|
| watchdog ssh fail-open | `ssh <host> tmux has-session` 命令 ssh 本身失败 | 单测注入 ssh 失败验 fail-open 路径 | 单测覆盖（可 CI 绿）|
| 收窗幂等 tmux kill | `ssh <host> tmux kill-session` + tmux_killed_at | 触发两次 watchdog 确认只 kill 一次 | logic-done-pending（tmux_killed_at DB 字段需 migration）|

---

## Out-of-Scope 标注

**PRD Golden Path 第 6 步（codex 自回写 Brain）**：本 sprint **不测**。
理由：codex 自回写是 session 内由 controller prompt 指令驱动的行为，不是 Brain 代码实现的功能；
无法在不启动真实 codex TUI 的情况下做到可重复的 CI 验收。该步骤属于 E2E 集成验收范畴，
留待后续专项 sprint（真机 E2E）覆盖。
