# DoD — 修复刀A/刀B workflow YAML unparseable（0-job startup failure）
- [x] [BEHAVIOR] nightly-regression.yml 与 integration-nightly.yml 可被 YAML 解析（顶格 markdown alias 病根治）
  Test: tests/ → packages/brain/src/__tests__/nightly-regression-config.test.js（yaml-parse 断言，先红后绿）
- [x] [BEHAVIOR] 三把刀三件套 yaml-parse 守卫永久进 CI（防同类病复发）
  Test: tests/ → packages/brain/src/__tests__/nightly-regression-config.test.js
- [x] CI 全绿
