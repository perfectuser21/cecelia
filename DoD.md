# 清退旧OpenClaw周期读取与群聊补账

Task: 34abb43c-46c0-4c54-9154-702adb64fc98
GP-Anchor: none(infra)

- [x] 真实默认调度轮退出OpenClaw运行采集与旧bot飞书补账，Notion及手机审计继续执行。
  Test: manual:npx --no-install vitest run --root packages/brain src/__tests__/scheduler-jobs.test.js
- [x] bypass入口零SQLite/SSH调用，手机事件、查询、汇总、Bark确认回执与锁权限边界保留。
  Test: manual:npx --no-install vitest run --root packages/brain src/__tests__/bypass-audit.test.js src/__tests__/bypass-bark-receipt.test.js src/routes/__tests__/bypass-actions.test.js
- [x] UTF16截断等价迁移，历史OpenClaw Runs投影仍可正确构造，历史数据与收结入口不改。
  Test: manual:npx --no-install vitest run --root packages/brain src/lib/__tests__/truncate-text.test.js src/__tests__/runs-notion-projection.test.js
- [x] Notion入账、员工飞书任务路由、native与手机Registry/grants回归保留；退役回归经业务变异证明。
  Test: manual:npx --no-install vitest run --root packages/brain src/__tests__/notion-gtd-sync src/__tests__/notion-push-sync src/__tests__/p2p-query-dispatch.test.js src/__tests__/native-agent-executor.test.js src/phone-dispatch
- [x] 当前manifest完整采集通过，默认1802/deep329；继承Worker fixture35例与外部新源码，版本事实及Scripts通过。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
