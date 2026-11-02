# DoD：退役 CI 配置的验证入口

- [x] [BEHAVIOR] 固定 Git 事实接受完整已审的新旧入口，混配与漂移拒绝，声明不自动取得执行或 owner 资格。
  Test: manual:node --test scripts/ci/__tests__/basic-active-ci-retirement.test.mjs
- [ ] [BEHAVIOR] 既有验证输入与来源协议回归继续有效。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
- [ ] [ARTIFACT] 正常 PR 合并后 Main CI 与 CI 专属基线真实通过。
  Test: manual:bash scripts/check-version-sync.sh
