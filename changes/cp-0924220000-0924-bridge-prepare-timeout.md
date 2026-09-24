## Brain {VERSION} — 编排桥 prepare 超时默认 180s→600s 并支持 KERNEL_FLEET_ORCHESTRATOR_PREPARE_TIMEOUT_MS 覆盖

- 根因（任务 f61fc0c6，2026-09-24 21:50 实证）：MMV 建工作区 = `git clone --bare --no-hardlinks` 整库拷贝 + `npm ci`，两条 run 并发时实测 7 分钟；`orchestrator-remote-bridge.js` prepare 超时 180s 硬编码、无 env 覆盖（attempt 桥有 `KERNEL_FLEET_PREPARE_TIMEOUT_MS`，编排桥没有）→ Brain 先放弃、跑场机继续 prepare → 作业停在 prepared 占槽到 TTL，期间派发全部 429 deferred 空转（run 5ae4b0e2 后连续 6 次）。
- 修法：默认 600s；`KERNEL_FLEET_ORCHESTRATOR_PREPARE_TIMEOUT_MS` 可覆盖（非法值回落默认）；桥对象暴露 `prepareTimeoutMs` 供断言。后续刀：workspace-manager 用 `--shared/--reference` 代替整库拷贝，把 prepare 压到秒级。
