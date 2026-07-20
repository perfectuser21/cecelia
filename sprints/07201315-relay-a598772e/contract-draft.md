# 合同草案 — harness relay 收编 grok executor

**任务**: a598772e  
**分支**: cp-07201511-ws-a598772e  
**Sprint 目录**: sprints/07201315-relay-a598772e  
**起草日期**: 2026-07-20

---

## 背景与目标

把 grok 收编为 harness skill-relay 的第三正式 executor（对齐 codex 先例 isCodex 分支，harness-skill-relay.js:101）。实现后三厂商（claude/codex/grok）走量格局完整。

dispatch-worker.mjs:37 已有经验证的 grok buildCommand（`~/.grok/bin/grok -p <brief> --cwd <dir> --always-approve`），本 sprint 把等价逻辑接进 relay 路径。

---

## 功能需求（FR）

### FR-1: executor 白名单扩展

`packages/brain/src/routes/task-tasks.js` 行 107 的 executor 白名单由 `claude|codex` 扩展为 `claude|codex|grok`。

- `POST /api/brain/tasks` 带 `payload.executor=grok` + `payload.orchestrator=skill-relay` → 200 接受
- `executor=grok` + 非 `skill-relay` orchestrator → 400 拒绝（同 codex 约束）
- `executor=grok` 时错误消息保持一致

### FR-2: isGrok 分支 + GROK_RELAY_HOME 凭据门禁

`spawnSkillRelaySession` 内识别 `task.payload.executor === 'grok'`，按与 isCodex 对称的逻辑处理：

- `GROK_RELAY_HOME` 已配置但为空字符串 → loud 失败 + task 回滚（同 CODEX_RELAY_HOME 先例）
- `GROK_RELAY_HOME` 未定义（undefined）→ 允许继续（测试注入 spawnFn 覆盖）
- 凭据挂载：`${GROK_RELAY_HOME}:/home/cecelia/.grok:rw`（extraMounts）
- 容器命名：`cecelia-relay-${short}-gk` 固定后缀（对齐 codex 的 `-cx`）

### FR-3: grok 启动命令注入

容器内 `CECELIA_EXECUTOR=grok`，entrypoint.sh 新增 grok 分支：

```bash
if [[ "${CECELIA_EXECUTOR:-}" = "grok" ]]; then
  ~/.grok/bin/grok -p --cwd "$WORKTREE_PATH" --always-approve < "$PROMPT_FILE" 2>&1 | tee "$STDOUT_FILE"
fi
```

（参照 dispatch-worker.mjs:37 已验证的调用式）

### FR-4: initiative_runs 落行 — orchestrator_host='skill-relay-grok'

```sql
INSERT INTO initiative_runs
  (..., orchestrator_host, deadline_at, ...)
VALUES (..., 'skill-relay-grok', NOW() + INTERVAL '8 hours', ...)
```

deadline 8h 与 codex 对齐。

### FR-5: 单 slot 串行守门

进程内计数 `_activeGrokRelays`（对标 `_activeCodexRelays`）+ DB 层守门（查 initiative_runs WHERE orchestrator_host='skill-relay-grok' AND phase NOT IN ('done','failed')）。命中时返回 `{ ok: false, deferred: true, reason: 'grok_concurrent_limit' }`。

### FR-6: 撞墙 fallback — 降级 claude 重试一次

relay 侧监听容器 stdout，调用 `detectQuotaWall(output)`（复用 dispatch-worker.mjs:21 的 QUOTA_WALL_PATTERNS）。撞墙时降级到 claude executor 重试一次，不再重试 grok。

### FR-7: headed 模式 grok 映射

`HEADED_HOSTS` 加 `grok: 'skill-relay-grok-headed'`；`HEADED_TMUX_PREFIXES` 加 `grok: 'grok-relay-'`。headed 分支识别 `executor === 'grok'`，映射到对应 host/prefix。

### FR-8: 日志脱敏

容器日志不打印 GROK_RELAY_HOME 路径内的 auth token 内容（仅打印 `[skill-relay] session spawned: container=... executor=grok`）。

---

## 边界情况

| 场景 | 预期行为 |
|------|----------|
| GROK_RELAY_HOME=''（显式空）| loud 失败 + task 回滚到 queued |
| GROK_RELAY_HOME 未定义 | 允许继续（测试环境） |
| grok 撞墙（out of credits/rate limit/429）| 降级 claude 重试一次，不重试 grok |
| 并发 grok relay 存在 | deferred, reason=grok_concurrent_limit |
| executor=grok + orchestrator!=skill-relay | 400 |
| claude/codex 既有路径 | 零改动，全量单测通过 |

---

## 受影响文件

- `packages/brain/src/harness-skill-relay.js` — isGrok 分支 + GROK_RELAY_HOME + headed 映射
- `packages/brain/src/routes/task-tasks.js` — executor 白名单 grok
- `docker/cecelia-runner/entrypoint.sh` — CECELIA_EXECUTOR=grok 分支
- `docker-compose.yml` — GROK_RELAY_HOME env 注入
- `packages/brain/src/__tests__/harness-skill-relay.test.js` — grok 单测
- `packages/brain/scripts/smoke/relay-grok-executor-smoke.sh` — smoke 脚本（新增）
- `packages/brain/scripts/smoke/smoke-allowlist.txt` — 登记新 smoke 脚本

---

## E2E 验收

### 场景 A — headless grok executor 全链

```bash
# 1. 注册 executor=grok 最小 harness 任务
TASK_ID=$(curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"grok-relay-e2e-验收","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"grok","sprint_dir":"sprints/07201315-relay-a598772e"}}' \
  | jq -r '.id')
echo "task_id=$TASK_ID"

# 2. 等待 relay spawn（约 10s）后查 initiative_runs
sleep 15
curl -s "localhost:5221/api/brain/harness/runs?task_id=$TASK_ID" | jq '.[] | {phase, orchestrator_host, deadline_at}'

# 断言：orchestrator_host == 'skill-relay-grok'，phase 非 failed，deadline 约 8h 后
```

### 场景 B — grok 容器日志验证

```bash
SHORT=$(echo $TASK_ID | cut -c1-8)
docker logs "cecelia-relay-${SHORT}-gk" 2>&1 | grep -E "\.grok/bin/grok|grok.*--always-approve"
# 断言：日志含 ~/.grok/bin/grok 启动行
```

### 场景 C — 撞墙 fallback 单测

```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-skill-relay.test.js \
  --reporter=verbose -t "grok 撞墙"
# 断言：detectQuotaWall 命中 QUOTA_WALL_PATTERNS → fallback claude 重试一次
```

### 场景 D — smoke 脚本全量 PASS

```bash
bash packages/brain/scripts/smoke/relay-grok-executor-smoke.sh
# 断言：所有 [PASS] 行，exit 0
```

### 场景 E — 回归保护

```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-skill-relay.test.js
# 断言：全量（含 claude/codex 既有测试）通过，无新红
```

### 最终 E2E（Final E2E）验收标准

以下断言全部满足才算 DONE（不可降级为 logic-done-pending）：

1. `initiative_runs.orchestrator_host = 'skill-relay-grok'` 行存在于 DB，phase 非 failed
2. `docker logs cecelia-relay-<short>-gk` 含 `~/.grok/bin/grok` 字样
3. relay 全链走完（planner → GAN → generator → evaluator），最终出 PR URL 并 merge
4. `detectQuotaWall` 撞墙路径单测覆盖：命中 QUOTA_WALL_PATTERNS → ok=false + fallback claude 重试一次
5. `relay-grok-executor-smoke.sh` 全部 PASS
6. 既有 claude/codex 单测全部仍 PASS（零回归）
7. headed relay 点火时 base_repo/pr_url 已写入 task payload（铁律 invariant 37e0d7c9）
