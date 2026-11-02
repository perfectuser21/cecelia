# DoD：退役配置的精确来源证明

- [x] [BEHAVIOR] 真实来源采集器接受已审退役配置，旧配置继续有效；命令、选择器或配置漂移拒绝。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/lib/__tests__/existing-ops-active-ci-retirement.test.js
- [x] [BEHAVIOR] 现行来源模块及组合封印回归通过，不改变正式门禁。
  Test: manual:npm exec --workspace cecelia-brain -- vitest run src/lib/__tests__/existing-ops-workspace-source.test.js src/lib/__tests__/existing-ops-active-admission-retirement.test.js
- [ ] [ARTIFACT] 版本同步并经正常 PR 与合并后源码 CI 验证。
  Test: manual:bash scripts/check-version-sync.sh
