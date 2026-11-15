- [ ] 清退七项弱 smoke 及两个 detached 专属 smoke，保留 ratchet 的基线、债务、拒绝与未知输入分类行为。
  Test: manual:bash -c 'node --test packages/brain/scripts/smoke/__tests__/*.node-test.mjs'
- [ ] 清退无生产上游的 detached 启动器及独立 test-docker CLI；保留 provider、allocation 与 worker-pool 真实行为回归。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/claude-channel-retired.launchers.test.js
- [ ] 现役调度、回调、guidance、收件箱分诊与 Notion 投影行为回归通过。
  Test: manual:npm exec -w packages/brain -- vitest run src/__tests__/scheduler-jobs.test.js src/lib/__tests__/callback-postprocess.test.js src/__tests__/guidance.test.js src/__tests__/capture-triage.test.js src/__tests__/notion-push-sync.test.js
- [ ] 默认脚本检查、版本和清单一致性通过；固定候选源码 CI 通过后正常合并并回写任务。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
