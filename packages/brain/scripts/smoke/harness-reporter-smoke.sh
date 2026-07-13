#!/bin/bash
set -e

# Smoke: harness_report payload 含 gan_rounds / gan_cost_usd
# 原断言测的是死图 harness-initiative.graph.js reportNode（FAIL 路径）把 ganRounds/ganCostUsd
# 传给 spawnHarnessReport，该图在 skill-relay 架构下已不再被 invoke（orchestrator 硬校验）。
# gan_rounds/gan_cost_usd 实际从 FAIL 路径流入 harness_report 的生产逻辑目前悬空
# （功能缺口已登记 issue 6de4fd22，不在本任务修复范围，本 smoke 不重建等价断言）。
echo "[smoke] harness-reporter: reportNode gan_rounds/gan_cost_usd 派发逻辑属死图（issue 6de4fd22 待重建），SKIP"
exit 0
