# Contract DoD — harness relay grok executor 收编

**TASK_ID**: a598772e-7f74-40f0-a022-d0e8d2b35dc0
**SPRINT_DIR**: sprints/07201315-relay-a598772e
**日期**: 2026-07-20

---

## DoD 清单

### 代码实现

- [ ] `packages/brain/src/harness-skill-relay.js` 新增 `isGrok = task.payload?.executor === 'grok'` 分支（L101 附近，不改 isCodex 判断）
- [ ] `GROK_RELAY_HOME` env 检查：`=''` → loud-fail + task 回滚到 queued；`=undefined` → 放行
- [ ] headless grok spawn：`extraMounts` 含 `${grokRelayHome}:/home/cecelia/.grok:rw`，启动命令含 `~/.grok/bin/grok -p <prompt> --cwd <dir> --always-approve`
- [ ] `containerId` 命名：`cecelia-relay-${short}-gk`（对齐 codex 的 `-cx` 后缀）
- [ ] `initiative_runs INSERT`：`orchestrator_host='skill-relay-grok'`（区别 codex 的 `skill-relay-codex`）
- [ ] deadline 对齐 `GROK_RELAY_DEADLINE_HOURS = 8`（与 codex 等级）
- [ ] `HEADED_HOSTS` 新增 `grok` 条目（headed 宿主 IP）
- [ ] `HEADED_TMUX_PREFIXES` 新增 `grok: 'grok-relay-'`
- [ ] `_spawnHeadedSession` L471 入口白名单同步加入 grok executor
- [ ] headed grok 分支：`GROK_RELAY_HOME=''` → 同样 loud-fail（对齐 codex headed 门禁 L478-491）
- [ ] `detectQuotaWall` 函数（或复用 dispatch-worker.mjs 逻辑）：匹配 `out of credits / rate limit / 429 / quota exceeded / quota reached / usage limit`
- [ ] 撞墙 fallback：grok 撞墙 → console.warn + executor 降级 claude → 重试一次；非撞墙失败不换 executor
- [ ] `env.CECELIA_EXECUTOR` 在 grok 路径赋值为 `'grok'`（容器日志可见）
- [ ] grok 路径**不**引入 `_activeGrokRelays` 进程内守门（初版无历史数据支撑限制值）

### 测试（packages/brain/src/__tests__/harness-skill-relay.test.js）

- [ ] [BEHAVIOR-1] isGrok 分支识别单测（fake spawnFn 注入，验证 CECELIA_EXECUTOR='grok'）
- [ ] [BEHAVIOR-2] `GROK_RELAY_HOME=''` loud-fail + task 回滚单测（spawnFn 未被调用，pool UPDATE queued）
- [ ] [BEHAVIOR-3] `GROK_RELAY_HOME=undefined` 放行单测（spawnFn 被调用，r.ok===true）
- [ ] [BEHAVIOR-4] headless spawn 参数正确性单测（extraMounts、orchestrator_host='skill-relay-grok'、deadline=8h）
- [ ] [BEHAVIOR-5] `detectQuotaWall` 全 pattern 覆盖单测（6 个 pattern 各返回 true，正常输出返回 false）
- [ ] [BEHAVIOR-6] 额度撞墙 fallback 路径单测（grok 撞墙 → claude 重试，二次 spawnFn CECELIA_EXECUTOR='claude'）
- [ ] [BEHAVIOR-7] headed grok 入口白名单单测（headedExecutor='grok'，tmuxPrefix='grok-relay-'）
- [ ] [BEHAVIOR-8] 回归：现有 isCodex/claude 全量测试绿（_activeCodexRelays 不变，orchestrator_host 区分正确）

### 集成 / 冒烟

- [ ] `packages/quality/smoke-allowlist.txt` 登记 grok relay 相关测试条目（CI 铁律 3efefc23）
- [ ] `npm test` 全量 `packages/brain/src/__tests__/harness-skill-relay.test.js` 通过
- [ ] brain-ci.yml CI 绿（不提前合并，等 CI 完成）

---

## E2E 验收

**target_environment**: local_api
**验收脚本**: `sprints/07201315-relay-a598772e/e2e-verify.sh`

### 验收点

| # | 验收点 | 断言方式 | Pass 标准 |
|---|--------|---------|-----------|
| E1 | grok 二进制实跑证明 | `docker logs cecelia-relay-{short}-gk 2>&1 \| grep -E "grok"` | 日志中出现 grok 进程启动标志 |
| E2 | 全链任务完成 | `GET localhost:5221/api/brain/tasks/{TASK_ID}` | `status = 'completed'` |
| E3 | initiative_runs 落行 done | `psql cecelia -c "SELECT phase FROM initiative_runs WHERE initiative_id='{TASK_ID}'"` | phase = `done` |
| E4 | PR 产出 | `GET localhost:5221/api/brain/tasks/{TASK_ID}` result 字段或 initiative_runs | `pr_url` 非空 |
| E5 | 容器挂载验证 | `docker inspect cecelia-relay-{short}-gk \| jq '.[].HostConfig.Binds'` | 含 `/home/cecelia/.grok` |
| E6 | orchestrator_host 区分 | `psql cecelia -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='{TASK_ID}'"` | `skill-relay-grok` |
| E7 | 撞墙 fallback 单测 CI 绿 | `npm test -- --grep "quota.*fallback\|detectQuotaWall"` | 全通过，exit 0 |
| E8 | 回归：全量 relay 测试 | `npm test packages/brain/src/__tests__/harness-skill-relay.test.js` | 全通过，exit 0 |

### manual:bash 验收命令

```bash
# ── E2E 验收命令组 ──────────────────────────────────────────────────────────
# 前置：确认 TASK_ID 和 SHORT（task id 前8位去横线）
TASK_ID="a598772e-7f74-40f0-a022-d0e8d2b35dc0"
SHORT=$(echo "$TASK_ID" | tr -d '-' | cut -c1-8)
CONTAINER="cecelia-relay-${SHORT}-gk"

# E1: grok 二进制实跑证明（日志含 grok 进程名）
docker logs "$CONTAINER" 2>&1 | grep -E "grok" \
  && echo "PASS E1: grok binary confirmed in logs" \
  || echo "FAIL E1: grok binary not found in logs"

# E2: 任务 status=completed
STATUS=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}" | jq -r '.status')
[ "$STATUS" = "completed" ] \
  && echo "PASS E2: task status=completed" \
  || echo "FAIL E2: task status=${STATUS}"

# E3: initiative_runs phase=done
PHASE=$(psql cecelia -At -c "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY created_at DESC LIMIT 1")
[ "$PHASE" = "done" ] \
  && echo "PASS E3: initiative_runs phase=done" \
  || echo "FAIL E3: initiative_runs phase=${PHASE}"

# E4: PR URL 非空
PR_URL=$(curl -s "http://localhost:5221/api/brain/tasks/${TASK_ID}" | jq -r '.result.pr_url // empty')
[ -n "$PR_URL" ] \
  && echo "PASS E4: PR URL=${PR_URL}" \
  || echo "FAIL E4: PR URL is empty"

# E5: 容器挂载含 .grok
MOUNTS=$(docker inspect "$CONTAINER" 2>/dev/null | jq -r '.[].HostConfig.Binds[]?' 2>/dev/null || echo "")
echo "$MOUNTS" | grep -q ".grok" \
  && echo "PASS E5: .grok mount found" \
  || echo "FAIL E5: .grok mount not found in container binds"

# E6: orchestrator_host=skill-relay-grok
ORC_HOST=$(psql cecelia -At -c "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY created_at DESC LIMIT 1")
[ "$ORC_HOST" = "skill-relay-grok" ] \
  && echo "PASS E6: orchestrator_host=skill-relay-grok" \
  || echo "FAIL E6: orchestrator_host=${ORC_HOST}"

# E7: 撞墙 fallback 单测
cd /workspace && npm test packages/brain/src/__tests__/harness-skill-relay.test.js -- --grep "quota|detectQuotaWall|fallback" \
  && echo "PASS E7: quota fallback tests pass" \
  || echo "FAIL E7: quota fallback tests failed"

# E8: 全量 relay 回归测试
cd /workspace && npm test packages/brain/src/__tests__/harness-skill-relay.test.js \
  && echo "PASS E8: all relay tests pass" \
  || echo "FAIL E8: relay regression test failed"
```

---

## 依赖假设（评估器不验证，但 planner 须知）

- `~/.grok/bin/grok` 在宿主已存在，通过挂载 `GROK_RELAY_HOME` 可在容器内访问（PRD ASSUMPTION）
- `auth.json` 在 `~/.grok/` 下，权限 600，不进 git、不进日志（铁律 564802ee）
- grok CLI `-p <brief> --cwd <dir> --always-approve` 调用签名已在 dispatch-worker.mjs L37 生产验证
- runner 镜像不预装 grok 二进制，通过挂载宿主 `~/.grok/bin/grok` 解决，无需镜像 rebuild

---

## 验收签名

evaluator 验收完毕后在此签名：

```
[ ] proposer 通过
[ ] evaluator 通过（PASS/FAIL 每点明确标注）
[ ] CI 绿
[ ] PR merged
```
