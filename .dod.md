# 清理定义文档历史流水账与无业务效果的文案互锁

Task: 52288b4b-dde6-40a3-a2a5-9701668c07ad
GP-Anchor: none(infra)

- [x] 原定义文档只保当前源码事实和入口，版本、schema地板及路由后备值含义明确。
  Test: manual:node scripts/facts-check.mjs
  Test: manual:bash scripts/check-version-sync.sh
- [x] 移除文档摘要grep后，真实镜像配置、版本与安装参数互锁继续执行。
  Test: manual:bash packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh
- [x] 保留真实profile/config/rollout及文档版本漂移、治理回归；只清退历史文案专属断言。
  Test: manual:node node_modules/vitest/vitest.mjs run --root packages/brain ../../tests/gp/f1/step3-runner-digest-pin-consistency.test.js ../../tests/check-version-sync.test.js src/lib/__tests__/implementation-ci-governance.test.js
- [x] 事实权威仍由源码提取；错误版本或schema破坏能真实报错。
  Test: manual:node --test scripts/ci/__tests__/basic-facts-authority.test.mjs
