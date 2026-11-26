# MMV 101 后继运行准入快照验收

- [x] 仅已认证的 GET 请求可读取指定 MMV 101 已审核后继运行的最小投影。多余字段、其他设备及其他原任务一律拒绝。
  Test: manual:npm test --workspace packages/brain -- --config vitest.integration.config.js src/routes/__tests__/integration/cloud-101-admission.test.js
- [x] 用真实 HTTP 和本地 PostgreSQL 核验 TaskRun 结束、原任务停机、审核撤回、设备租约改变和部署观测切换均能在下一次读取中识别。
  Test: manual:npm test --workspace packages/brain -- --config vitest.integration.config.js src/routes/__tests__/integration/cloud-101-admission.test.js
- [x] 鉴权前每 IP 一秒限 48 次。缺令牌的请求不计入鉴权后的快照限额。
  Test: manual:npm test --workspace packages/brain -- --config vitest.integration.config.js src/routes/__tests__/integration/cloud-101-admission.test.js
- [x] 专用入口在独立一秒窗口内接受 24 个请求，并拒绝第 25 个。以每秒 15 次的节奏发送 320 次请求，全部成功。
  Test: manual:CLOUD_101_ADMISSION_LOAD=1 npm test --workspace packages/brain -- --config vitest.integration.config.js src/routes/__tests__/integration/cloud-101-admission.test.js
