# Learning — smoke-fix-d-tick (2026-04-26)

## 背景

CI workflow `real-env-smoke` job（PR #2653 引入）在 fresh docker container 内跑
`packages/brain/scripts/smoke/*.sh`，要求每条 smoke 在干净 postgres + 全新 brain
容器下能 PASS。`d-tick-runner-full.sh` 是 4 个范本 smoke 之一，其在 CI 必 fail。

## 根本原因

CI 环境与生产环境差异 4 处，原 smoke 全部硬编码生产假设：

1. **容器名硬编码 `cecelia-node-brain`**：CI 用 `cecelia-brain-smoke`，docker exec 找不到
   容器 → 静态验 fail。
2. **依赖 `loop_running=true`**：CI 设 `CECELIA_TICK_ENABLED=false`（虽 DB 默认
   enabled=true 仍会自启 loop，但 fresh DB 极短窗口内 loopTimer 可能还没起）。
3. **依赖 130s 等自然 tick**：CI 干净环境 brain 刚起就跑 smoke，等 1 个完整
   `TICK_INTERVAL_MINUTES`(=2min) 周期才能验 last_tick 推进；timeout 不稳定。
4. **runtime 阈值 ≥6/8 plugin docker logs 痕迹**：空 DB 多数 plugin silent on no-op
   （`dept-heartbeat` / `heartbeat-plugin` / `kr-progress-sync-plugin` /
   `goal-eval-plugin` / `kr-health-daily-plugin` / `pipeline-patrol-plugin` /
   `pipeline-watchdog-plugin` / `cleanup-worker-plugin` 中 5+ 个在空 DB 啥也不做不打 log）
   → runtime 命中 < 6 → fail。

## 修复

不改 brain 代码，重写 smoke 脚本契约：

1. **容器名自动检测**：`BRAIN_CONTAINER` env > `cecelia-brain-smoke` > `cecelia-node-brain`
2. **主动 POST `/api/brain/tick`** 触发 `runTickSafe('manual')` → `executeTick()`，
   不再被动等 loop（manual tick 不受 throttle gate 限制，立刻执行所有 plugin）
3. **强契约**：sleep 3s 后再读 `/tick/status`，验 `last_tick` 推进 OR
   `tick_stats.total_executions++`（任一推进即通过 —— 因为 executeTick 是 8 plugin
   串行调用的根入口，能写到 DB tick_last/tick_stats 就证明所有 plugin 已被调用）
4. **静态验** 8 plugin import 保留（防 wire 被悄悄删）
5. **runtime log 降为软验**（阈值 ≥1，仅作 diagnostic — 强契约 [3] 已兜底）

## 下次预防

- [ ] 写 smoke 脚本时**先想 CI 干净环境**：容器名、env 变量、空 DB 副作用
- [ ] **主动触发 > 被动等**：能用 manual API 就别等 loop，写 smoke 不要靠等时间
- [ ] **强契约 vs 软契约分离**：日志命中之类的 fragile signal 当 diagnostic，
      DB 推进之类的 atomic signal 当强契约（exit 1 依据）
- [ ] 容器名一律走 `detect_container()` env+fallback 三档兜底，禁止脚本里硬编码生产名
- [ ] 完成 smoke **必须本机 CI-style docker compose 真跑**（非生产容器），
      `--network bridge` + `CECELIA_TICK_ENABLED=false` + 容器名 `cecelia-brain-smoke`

## 验证

- 本机 fresh postgres (pgvector:pg15) + brain 容器（--network bridge,
  `CECELIA_TICK_ENABLED=false`, 容器名 `cecelia-brain-smoke`）跑 smoke：5/5 阶段 PASS
- 容器名自动检测验过：BRAIN_CONTAINER 不设也能找到 `cecelia-brain-smoke`
- `bash -n` 语法 OK
- 8 plugin 静态 import 全命中
