# DoD：测试验证真实行为并由正确跑道执行

- [x] [BEHAVIOR] 静态资源真实返回文件、缓存和gzip字节；SPA fallback预算耗尽返回429而健康检查正常；Brain代理真实转发路径、body及错误状态。
  Test: manual:npm exec --workspace @cecelia/core -- vitest run src/dashboard/__tests__/server-perf.test.ts src/__tests__/brain-api-integration.test.ts
- [x] [BEHAVIOR] captures测试调用真实Router，验证CRUD、SQL参数、返回内容与失败状态；重复intent与框架自测退出CI。
  Test: manual:npm exec --workspace @cecelia/core -- vitest run tests/capture/api.test.ts src/__tests__/intent-recognition.test.ts
- [x] [BEHAVIOR] captures schema明确使用已迁移专用PG；不可达或错误目标必须失败，Nightly真实执行。
  Test: manual:node --test scripts/ci/__tests__/basic-capture-schema-lane.test.mjs
- [x] [BEHAVIOR] MCP单元与PG独立；SQL/当前run错误应报红，原9项DB合同由Nightly实际执行且清理失败不冒充通过。
  Test: manual:node --test scripts/ci/__tests__/basic-mcp-pg-lane.test.mjs
- [x] [BEHAVIOR] 六组兼容测试路径只执行唯一真实owner；四份活跃PG回归转入Deep且不能以skip掩盖数据库故障。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-test-debt.test.mjs
- [x] [BEHAVIOR] incidents导入失败直接失败；保留真实Router错误500和实际拒绝路径的回写验证。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run ../../tests/regression/incidents-layer/incidents-api.test.js src/__tests__/harness-initiative-executor-writeback.test.js
- [x] [BEHAVIOR] 旧canary/ops自造实现测试退出CI，实际实现的故障处置、降级、任务计数与锁保护仍有真实回归。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/canary-drill-assert-loop.test.js src/__tests__/canary-drill-inject-form.test.js src/__tests__/canary-drill-scheduler-path.test.js src/routes/__tests__/ops-panorama-runtime.test.js src/lib/__tests__/ops-panorama-probes.test.js
- [ ] [ARTIFACT] 版本同步、隔离回归和实际反例通过，正常受保护PR验收；不部署生产。
  Test: manual:bash scripts/check-version-sync.sh
