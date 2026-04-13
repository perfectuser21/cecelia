### 根本原因

Health 端点响应对象中缺少 `harness_version` 字段，导致 Harness v5.1 版本标识无法通过 API 对外暴露。在 `packages/brain/src/routes/goals.js` 的 `/health` 路由 `res.json()` 调用中添加 `harness_version: '5.1'` 字段即可满足合同要求。

### 下次预防

- [ ] 新增响应字段时，确认字段类型与合同一致（字符串 vs 数字）
- [ ] 只修改合同指定的文件和位置，不触碰其他字段
