# 修复普通任务标识被误识别为设备意图

Task: ad48434f-e2d5-4464-8c60-034ef11b7665
GP-Anchor: none(infra)

- [ ] 含adb的UUID/普通标识不能触发手机设备意图，真实独立adb命令及显式设备要求仍严格验真。
  Test: manual:cd packages/brain && npx --no-install vitest run src/routing/__tests__/native-qiumi-route.test.js src/routing/__tests__/cheap-gates.test.js
- [ ] 固定含adb任务ID的普通任务经真实dispatcher/PG原生运行账本，不重复启动保护保持；前置路由和运行绑定有明确断言。
  Test: manual:node scripts/ci/run-basic-check.mjs brain-integration
- [ ] 只读noexec镜像完成/取消合同和来源防复活仍通过，main自动发布后核对生产SHA、版本和业务回执。
  Test: manual:node scripts/ci/run-basic-check.mjs image
