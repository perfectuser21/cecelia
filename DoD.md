# DoD — cp-0426222852-smoke-fix-d-tick

## Goal

修 `packages/brain/scripts/smoke/d-tick-runner-full.sh` — CI real-env-smoke 干净环境跑过。

原 smoke 假定 `loop_running=true` + 等 130s 自然 tick + docker logs 命中 ≥6/8 plugin。
CI real-env-smoke 设 `CECELIA_TICK_ENABLED=false`，且 fresh DB 多数 plugin silent on no-op，
docker logs runtime 命中 < 6/8 → CI 必 fail。

修后：smoke 不依赖 loop / log；主动 POST /api/brain/tick 触发 manual tick，
验 last_tick 推进 + total_executions++（强契约 — 证明 executeTick 走完整 plugin 序列）。
runtime 日志降为软验（diagnostic only，阈值 ≥1）。

## Artifact

- [x] [ARTIFACT] smoke 脚本存在且可执行
      Test: manual:node -e "const fs=require('fs');const s=fs.statSync('packages/brain/scripts/smoke/d-tick-runner-full.sh');if((s.mode&0o100)===0)process.exit(1)"

## Behavior

- [x] [BEHAVIOR] smoke 自动检测 brain 容器名（BRAIN_CONTAINER env > cecelia-brain-smoke > cecelia-node-brain）
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/d-tick-runner-full.sh','utf8');if(!c.includes('cecelia-brain-smoke'))process.exit(1);if(!c.includes('cecelia-node-brain'))process.exit(1);if(!/detect_container/.test(c))process.exit(1)"

- [x] [BEHAVIOR] smoke 主动 POST /api/brain/tick 触发 manual tick（不依赖 loop / TICK_ENABLED）
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/d-tick-runner-full.sh','utf8');if(!/curl -sf -X POST.*\/api\/brain\/tick/.test(c))process.exit(1)"

- [x] [BEHAVIOR] smoke 验 last_tick 推进 + tick_stats.total_executions++（强契约）
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/d-tick-runner-full.sh','utf8');if(!/LAST_TICK_AFTER.*!=.*LAST_TICK_BEFORE/.test(c))process.exit(1);if(!/EXEC_COUNT_AFTER.*-gt.*EXEC_COUNT_BEFORE/.test(c))process.exit(1)"

- [x] [BEHAVIOR] smoke 静态验 tick-runner.js 8 plugin import 全 wired
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/d-tick-runner-full.sh','utf8');for(const p of ['dept-heartbeat','kr-progress-sync-plugin','heartbeat-plugin','goal-eval-plugin','pipeline-patrol-plugin','pipeline-watchdog-plugin','kr-health-daily-plugin','cleanup-worker-plugin'])if(!c.includes(p)){console.error('missing plugin name:',p);process.exit(1)}"

- [x] [BEHAVIOR] smoke runtime log 阈值降为 ≥1（软验，CI 空 DB 下多 plugin silent on no-op）
      Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/d-tick-runner-full.sh','utf8');if(!/SMOKE_PLUGIN_RUNTIME_MIN:-1/.test(c))process.exit(1)"

- [x] [BEHAVIOR] smoke bash 语法 OK
      Test: manual:bash -n packages/brain/scripts/smoke/d-tick-runner-full.sh

- [x] [ARTIFACT] Learning 文档存在
      Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-04262228-smoke-fix-d-tick.md')"

## Constraints

- 不动 brain 业务代码（仅改 smoke 脚本）
- 仅改 `packages/brain/scripts/smoke/d-tick-runner-full.sh`（task scope）
- 不改 CI workflow / SKILL / engine 版本

## 成功标准

- 本机 CI-style docker setup（fresh postgres + fresh brain + CECELIA_TICK_ENABLED=false +
  --network bridge + 容器名 cecelia-brain-smoke）下 smoke 真跑过，全 5 阶段 PASS
- 容器名自动检测对 cecelia-brain-smoke / cecelia-node-brain 双场景适配
- 强契约（last_tick 推进）兜底，软契约（docker logs）只作 diagnostic
