# PRD: smoke-fix-D — 修 d-tick-runner-full.sh CI 干净环境跑过

## 背景

CI workflow `.github/workflows/ci.yml` 的 `real-env-smoke` job（PR #2653 引入）在 fresh
docker 环境内：
- 起 `cecelia-brain:ci` 容器，name `cecelia-brain-smoke`，--network host
- 设 `CECELIA_TICK_ENABLED=false`、`NODE_ENV=test`
- 等 `/api/brain/tick/status` 200 后扫 `packages/brain/scripts/smoke/*.sh` 全跑

`d-tick-runner-full.sh` 在该环境必 fail：
1. **容器名硬编码** `cecelia-node-brain`（生产名），CI 用 `cecelia-brain-smoke` → 静态验
   `docker exec` 失败。
2. **依赖 loop_running=true**：CI 设 `CECELIA_TICK_ENABLED=false`（虽 DB 默认 enabled
   仍会自启 loop，但 fresh DB 时第一个 tick 还没跑出来，loop_running 可能为 false）。
3. **依赖 130s 等自然 tick**：fresh DB 等周期 ≥ TICK_INTERVAL_MINUTES (2min) 才能验
   last_tick 推进；20min timeout 不够稳。
4. **runtime 阈值 ≥6/8**：空 DB 多数 plugin silent on no-op（dept-heartbeat / heartbeat /
   pipeline-patrol 之外的 5 个 plugin 在 fresh DB 啥也不做）→ 必 < 6/8 → fail。

## 目标

让 `d-tick-runner-full.sh` 在 CI fresh 环境秒级跑过，同时在生产容器上仍可跑。

## 范围

**只改 1 个文件**：`packages/brain/scripts/smoke/d-tick-runner-full.sh`

## 不做

- 不动 brain 业务代码
- 不动 CI workflow（task A 已经覆盖 #2653 临时 continue-on-error）
- 不动 SKILL / engine 版本
- 不写 c8a / e1 / B retire smoke（其他 task 覆盖）

## 实现要点

### 5 阶段重构契约

1. `/api/brain/tick/status` 可达 + `enabled` 字段存在（不再要求 `loop_running=true`）
2. **POST `/api/brain/tick`** 主动触发 manual tick（`runTickSafe('manual')` → `executeTick()`
   走完整 plugin 序列）；`response.success===true` 或 `response.skipped===true`(reentry guard)
   都算通过
3. **强契约**：sleep 3s 后 GET `/tick/status`，验 `last_tick` 推进 OR
   `tick_stats.total_executions++`（任一推进即通过 — 证明 executeTick 端到端跑过）
4. **静态验**：`docker exec <container> grep -F "from './<plugin>.js'" /app/src/tick-runner.js`
   8 个 plugin 全命中（防重构悄悄删 wire）
5. **软验**：docker logs 命中阈值降为 ≥1（diagnostic only — 强契约 [3] 已兜底）

### 容器名自动检测

```bash
detect_container() {
  if [ -n "${BRAIN_CONTAINER:-}" ]; then echo "$BRAIN_CONTAINER"; return; fi
  for c in cecelia-brain-smoke cecelia-node-brain; do
    if docker ps --format '{{.Names}}' | grep -qx "$c"; then echo "$c"; return; fi
  done
}
```

env > CI 容器 > 生产容器，三档兜底。

## 成功标准

- 本机 CI-style docker setup（fresh postgres + brain --network bridge + container=
  cecelia-brain-smoke + CECELIA_TICK_ENABLED=false）下 smoke 真跑过 ✅
- 本机生产 cecelia-node-brain 容器上 smoke 仍跑过（向后兼容）
- CI real-env-smoke job 在本 PR 跑过（验证 CI 干净环境契约）
- 5 阶段全 PASS，输出可读
