# ws2 Red 证据

- 基线：`9e2162962c5e47199be098820911605681b6a049`
- 共享棋盘 blob：`5f009c2ab6cc3714ac161df88958def344aafece`
- 命令：`npx vitest run sprints/07240958-relay-1fd063d0/tests/codex-slot-contract.test.ts --reporter=json --outputFile=/tmp/ws2-red-report.json`
- 结果：`exit_code=1`，`total=11`，`passed=3`，`failed=8`

ws1 已绿的两个旧入口与 migration 三条断言保持通过。ws2 开工前，`packages/brain/src/codex-slot-broker.js`、`packages/brain/src/routes/codex-slots.js`、`scripts/codex-slot` 与 `scripts/codex-slot-client.mjs` 均不存在；共享棋盘因此在 broker SSOT 与 acquire/stop/reap exact API 断言上保持 Red。其余失败属于 ws3–ws6 尚未实施的分段，不在本棒放宽或修改。
