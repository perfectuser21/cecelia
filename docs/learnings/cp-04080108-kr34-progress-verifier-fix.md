# Learning: KR3/KR4 进度采集链路修复

## 任务背景
修复 KR3（微信小程序上线）和 KR4（geo SEO网站上线）进度始终为 0%，采集链路失效。

### 根本原因

1. **verifier SQL 只计算 `completed` 项目**：公式 `COUNT(completed)/COUNT(total)*100`，所有项目为 `inactive` 时 = 0/2 = 0%
2. **okr_projects 未激活**：P1 项目 start_date = 今天（2026-04-08），但状态仍为 `inactive`
3. **无中间状态表达**：`inactive/active/completed` 三态，原公式只区分两态（done/not done）

### 下次预防

- [ ] 里程碑类 KR 的 verifier 应使用阶梯权重公式，而非纯 `completed/total`
- [ ] 创建 `okr_projects` 时，如果 `start_date <= TODAY`，应直接设为 `active` 状态
- [ ] migration 安装 verifier 时，同步更新 `key_results.progress` 初始值（不能等下一个 hourly tick）
- [ ] `POST /api/brain/okr/verifiers/run` 端点已添加，运维时可手动触发

### 修复方案
- migration 224：更新 verifier SQL（阶梯权重）+ 激活 P1 项目 + 立即回填进度
- `packages/brain/src/routes/goals.js`：新增 `POST /api/brain/okr/verifiers/run` 强制触发端点
- `packages/brain/src/selfcheck.js`：EXPECTED_SCHEMA_VERSION 升至 224
