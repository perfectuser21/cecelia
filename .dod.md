# 消除测试入口重复hash与业务回归冗余冷却等待

Task: 0e28d02d-2408-4347-bb0e-a76b74bdb1bc
GP-Anchor: none(infra)

- [ ] 两处安全fixture使用冻结小型入口但真实执行Node/MCP与子孙进程；wrapper与entry漂移及孙进程清理保护保持可触发。
  Test: manual:npm test --workspace packages/brain -- src/orchestrator/__tests__/commander-checker-boundary.test.js src/orchestrator/__tests__/commander-host-tools.test.js
- [ ] 原诊断业务断言完整保留，独立固定5秒冷却与释放/派发/响应顺序保护通过；破坏真实诊断分支时回归报红。
  Test: manual:npm test --workspace packages/brain -- src/__tests__/execution-callback-no-diagnostic.test.js src/__tests__/callback-cooldown.test.js src/__tests__/callback-resilience.test.js
- [ ] 默认Brain文件集合与相关原案例多重集合不减，版本同步与完整CI通过。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] main push与dispatch保留原串行组但用max队列，避免pending被新main替换；PR/Dependabot/schedule原策略保持，真实YAML恢复single会报红。
  Test: manual:node --test scripts/ci/__tests__/basic-concurrency.test.mjs
- [ ] Nightly主集成的服务内PG客户端与已验证PR跑道同版，避免方法压缩参数不兼容；地图烟测和私有PG后端范围不扩大。
  Test: manual:node --test scripts/ci/__tests__/basic-nightly-consolidation.test.mjs
