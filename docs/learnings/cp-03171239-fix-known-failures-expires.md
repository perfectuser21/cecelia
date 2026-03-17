## known-failures noExpiry 升级为错误（2026-03-17）

### 根本原因

`check-rci-health.mjs` 中 `noExpiry`（缺少 expires 字段）的判断分支只输出 `⚠️` 警告，但没有设置 `hasErrors = true`。根本原因是写这段逻辑时把"建议"和"强制"混淆了——noExpiry 是一个需要强制阻塞的条件，不是建议性提示。

任务描述提到 `regression-contract.yaml` 里有 known-failures 条目，但实际上 known-failures 数据存放在 `ci/known-failures.json`，而不是 YAML 文件本身。这是任务描述中轻微的路径误差，探索代码后迅速定位到真正目标。

### 下次预防

- [ ] 写 CI 检查脚本时，任何"建议性"检查项如果真的影响 CI 质量，应该明确设为硬性错误（设置 `hasErrors = true`）而非仅警告
- [ ] 任务描述中的文件路径不可全信，探索实际代码是唯一准确的方式
