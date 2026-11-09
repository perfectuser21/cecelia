# DoD：清退旧部署与手动 staging 工作流

- [x] [ARTIFACT] 删除已停用的 brain-ci-deploy、deploy 和旧手动 auto-staging-deploy、nightly-real-machine 工作流；清理专属 smoke、旧 daily-drill 及登记。
  Test: manual:bash -c 'git diff --check'
- [x] [BEHAVIOR] 保留生产 stage_candidate 的候选镜像、隔离数据库、迁移失败及身份拒绝保障。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/brain-staging-admission.test.js src/__tests__/staging-request-receipt.test.js
- [x] [BEHAVIOR] Preview 实际入口及按需 staging 脚本继续拒绝错身份、非成功HTTP和截断回执；发布预算保留有限截止。
  Test: manual:node --test scripts/ci/__tests__/basic-preview-deploy.test.mjs scripts/ci/__tests__/basic-release-contract-guard.test.mjs
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/deployment-time-budget.test.js
- [x] [BEHAVIOR] 固定历史来源继续回放，当前缺旧入口源码只能 UNKNOWN，不能复用历史 verified。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/lib/__tests__/existing-ops-staging-bootstrap.test.js
- [x] [BEHAVIOR] 完整 scripts 必需检查通过；Nightly 主体与现役所有 skills-source 调用者的身份校验保留。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/__tests__/nightly-regression-config.test.js

- [x] [BEHAVIOR] SHA串链默认入口清退旧YAML场景，保留真实S6错SHA拒绝、同SHA通过及source-only提前拒绝。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run tests/gate3-sha-account.test.js
