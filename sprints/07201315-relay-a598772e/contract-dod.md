# DoD — harness relay grok executor 收编

**任务**: a598772e  
**分支**: cp-07201511-ws-a598772e  
**创建日期**: 2026-07-20

---

## [BEHAVIOR] 行为断言

[BEHAVIOR-1] `POST /api/brain/tasks` 带 `payload.executor=grok` + `payload.orchestrator=skill-relay` 返回 200；带 `executor=grok` + 非 skill-relay orchestrator 返回 400（task-tasks.js 白名单）。

[BEHAVIOR-2] `spawnSkillRelaySession` 收到 `executor=grok` 任务时：容器命名为 `cecelia-relay-<short>-gk`；`extraMounts` 含 `${GROK_RELAY_HOME}:/home/cecelia/.grok:rw`；`CECELIA_EXECUTOR=grok` 注入 env；`initiative_runs` 落行 `orchestrator_host='skill-relay-grok'`，deadline 8h。

[BEHAVIOR-3] `GROK_RELAY_HOME` 为空字符串（显式错误配置）→ 不 spawn，ok=false，task 回滚到 queued（同 CODEX_RELAY_HOME 门禁先例）。`GROK_RELAY_HOME` 未定义（undefined）→ 允许继续（测试/本地环境免配）。

[BEHAVIOR-4] grok executor 单 slot 串行守门：进程内 `_activeGrokRelays > 0` 或 DB 查到活跃 `orchestrator_host='skill-relay-grok'` 行 → 返回 `{ ok: false, deferred: true, reason: 'grok_concurrent_limit' }`，不 spawn。

[BEHAVIOR-5] 容器 stdout 命中 `QUOTA_WALL_PATTERNS`（out of credits / rate limit / 429 等）→ ok=false + fallback：降级 claude executor 重试一次，不重试 grok。

[BEHAVIOR-6] headed 模式 `executor=grok` → `orchestrator_host='skill-relay-grok-headed'`，tmux session 前缀 `grok-relay-`，headed relay 点火必须写 `base_repo`/`pr_url` 到 task payload。

[BEHAVIOR-7] claude/codex 既有行为零改动：isCodex 路径（harness-skill-relay.js:101）、isClaudeHeaded 路径、CODEX_RELAY_HOME 门禁、_activeCodexRelays 守门，全量单测通过无回归。

---

## Definition of Done（每项必须满足）

### 代码实现

- [ ] `task-tasks.js` executor 白名单扩展为 `claude|codex|grok`（FR-1）
- [ ] `harness-skill-relay.js` isGrok 分支：凭据门禁 + extraMounts + 容器命名 `-gk` + initiative_runs 落行 `skill-relay-grok` + 8h deadline（FR-2~4）
- [ ] `harness-skill-relay.js` `_activeGrokRelays` 进程守门 + DB 并发守门（FR-5）
- [ ] `harness-skill-relay.js` 撞墙 fallback：detectQuotaWall → 降级 claude 重试一次（FR-6）
- [ ] `harness-skill-relay.js` HEADED_HOSTS/HEADED_TMUX_PREFIXES 加 grok 映射（FR-7）
- [ ] `entrypoint.sh` CECELIA_EXECUTOR=grok 分支（FR-3 对应）
- [ ] `docker-compose.yml` GROK_RELAY_HOME env 注入（照 CODEX_RELAY_HOME 先例）
- [ ] 日志不打印 auth token 内容（FR-8，铁律：日志脱敏）

### 测试

- [ ] `harness-skill-relay.test.js` 新增 grok 相关单测（happy path / GROK_RELAY_HOME 门禁 / 撞墙 fallback / 串行守门 / headed 映射）
- [ ] 全量单测通过（含既有 claude/codex 测试）
- [ ] TDD 红基线：测试文件先提交（红），实现后变绿

### Smoke

- [ ] `packages/brain/scripts/smoke/relay-grok-executor-smoke.sh` 新增（照 relay-codex-executor-smoke.sh 先例）
- [ ] 登记进 `packages/brain/scripts/smoke/smoke-allowlist.txt`（铁律：smoke 登记纪律）

### 铁律覆盖

| 铁律 | 覆盖方式 |
|------|---------|
| smoke 登记纪律 | smoke.sh + allowlist 同 PR 带齐 |
| 真环境验证才算 done | Final E2E 真跑容器，不 mock |
| 禁止写死环境假设值 | GROK_RELAY_HOME 从 env 读，不写死路径 |
| 凭据安全 | auth.json 只挂载，不复制，chmod 600，不进 git |
| 日志脱敏 | 容器日志不打印 grok auth token |
| 单 slot 串行 | _activeGrokRelays + DB 守门（对标 codex） |
| headed relay 点火必须写 base_repo/pr_url | headed 分支合同测试覆盖 |

---

## manual:bash 验收命令

### 单元测试（CI 可跑）

```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-skill-relay.test.js --reporter=verbose
```

### smoke 脚本

```bash
bash /workspace/packages/brain/scripts/smoke/relay-grok-executor-smoke.sh
```

### executor 白名单接口验收

```bash
# grok + skill-relay → 应接受（若 Brain 运行中）
curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"grok-contract-check","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"grok"}}' \
  | jq '{id, status, error}'

# grok + 非 skill-relay → 应 400
curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"grok-bad","task_type":"harness_initiative","payload":{"orchestrator":"graph","executor":"grok"}}' \
  | jq '{error}'
```

### initiative_runs 落行验收（Final E2E）

```bash
TASK_ID=$(curl -s -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"grok-e2e","task_type":"harness_initiative","payload":{"orchestrator":"skill-relay","executor":"grok","sprint_dir":"sprints/07201315-relay-a598772e"}}' \
  | jq -r '.id')

sleep 15
curl -s "localhost:5221/api/brain/harness/runs?task_id=$TASK_ID" \
  | jq '.[] | {orchestrator_host, phase, deadline_at}' \
  | grep -E '"skill-relay-grok"'
# 断言：输出含 skill-relay-grok
```

### 容器日志验证（Final E2E）

```bash
SHORT=$(echo $TASK_ID | cut -c1-8)
docker logs "cecelia-relay-${SHORT}-gk" 2>&1 | grep -E "\.grok/bin/grok"
```

### 回归保护

```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-skill-relay.test.js
# 期望：全量通过，零失败
```

---

## 累积 FR 保护（不得回退）

- codex executor relay（isCodex 分支，harness-skill-relay.js:101）：已在 main，本 PR 不改
- claude executor relay（default 路径）：已在 main，本 PR 不改
- headed 模式 codex/claude：已在 main，仅新增 grok 映射
- dispatch-worker.mjs grok buildCommand（:37）：已在 main，relay 侧沿用逻辑，不重复实现
