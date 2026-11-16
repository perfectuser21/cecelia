- [ ] PR/Main固定现役核心矩阵，移除Plan与按路径减少组件/运维回归，版本门仍在Scripts验证真实BASE/HEAD。
  Test: manual:node --test scripts/ci/__tests__/basic-workflow.test.mjs scripts/ci/__tests__/run-basic-check.test.mjs
- [ ] 预览入口独立判断真实UI变更，非UI/未知比较不得创建预览；PR关闭仍按原入口清理。
  Test: manual:node --test scripts/ci/__tests__/basic-preview-deploy.test.mjs
- [ ] 固定完整CI来源与实际读取边同步当前入口，旧完整组可读但当前不得降级，新旧混配/缺失/篡改拒绝，Claude禁用边界及运行身份协议保持。
  Test: manual:npm exec -w packages/brain -- vitest run src/lib/__tests__/existing-ops-current-ci-source.test.js src/lib/native-consumer-runtime.test.js
- [ ] 事实、版本、DoD与必要关联回归通过，独立复审后正常PR CI并合并，回写任务与清理本轮资源。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
