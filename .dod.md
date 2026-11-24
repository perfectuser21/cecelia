# 默认CI与按需真实资格/预览边界清理

Task: 1da79bcb-9cb6-4c19-a751-b6853d730a7e
GP-Anchor: none(infra)

- [ ] 默认夜间发现不登记三个人工预览服务及两条按需真实Codex专项；明确旗标仍能选择原实现，现役非模型PG合同继续收集。
  Test: manual:node --test scripts/ci/__tests__/basic-manual-integration-boundary.test.mjs
- [ ] 旧radius联动适配和专属检查无现役消费者，清退同时保留当前graph/radius与cascade-report功能，通用孤岛闸回归使用现役叶子。
  Test: manual:cd packages/brain && npx --no-install vitest run src/__tests__/cascade-list.test.js src/__tests__/island-gate.test.mjs
- [ ] 来源封组仅接受完整经审控制，历史56版本有效，缺失、漂移与新旧混配不能获得许可。
  Test: manual:cd packages/brain && npx --no-install vitest run src/lib/__tests__/existing-ops-ci-manual-boundary-source.test.js
- [ ] 保留当前必需PR和真实数据库合同，不新增workflow/job，独立真实Notion到原生Agent产物与回执证据已写验收Task。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
