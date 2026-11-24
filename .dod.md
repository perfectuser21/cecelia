# 修复候选镜像noexec业务验收

Task: ad48434f-e2d5-4464-8c60-034ef11b7665
GP-Anchor: none(infra)

- [ ] 只读、禁网及/tmp noexec环境下，实际原生CLI/worker/child完成唯一运行并核实产物及退出，旧夹具必须真实报红。
  Test: manual:node --test packages/brain/scripts/native-agent/__tests__/candidate-fixture.node-test.mjs
- [ ] 原生挂起会话取消只影响原run并确认进程组退出；镜像必需CI实际执行合同而非只导入。
  Test: manual:node --test scripts/ci/__tests__/basic-fixed-core.test.mjs
- [ ] 镜像来源采用独立完整已审封组，历史身份保留，不放宽未知来源/执行边界。
  Test: manual:cd packages/brain && npx --no-install vitest run src/lib/__tests__/existing-ops-ci-noexec-source.test.js
- [ ] 当前调度、Notion和候选真实PG回归通过，生产按main CI自动发布入口验收并读回精确SHA及结算。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
