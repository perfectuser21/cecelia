# Brain 单测长尾验收

Task: d58332fd-4b31-45f5-8419-669daa776746
GP-Anchor: none(infra)

- [ ] 原有 28 用例完整保留，六文件在实际 Vitest 中通过，fixture 每例隔离，controller 包含 helper。
  Test: manual:cd packages/brain && npx --no-install vitest run scripts/coding-workflow/runner/__tests__/source-merge- --reporter=verbose
- [ ] 原有 CI 和发布回归通过，生产源码与 workflow 不变。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:node scripts/ci/run-basic-check.mjs ops
- [ ] AST 对账、Vitest 全量集合核对和 PR/main 实际性能证据完成；认证经独审后刷新，首次完整发布。
  Test: manual:node --test scripts/ci/__tests__/basic-brain-deploy-certification.test.mjs
