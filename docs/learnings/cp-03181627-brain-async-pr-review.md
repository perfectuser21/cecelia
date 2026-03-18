# Learning: Brain 异步 PR Review

## 分支
cp-03181627-brain-async-pr-review

## 变更概要
引入 Brain 调度的异步 PR Review 系统，替代自写 agent_seal 的安全剧场。

### 根本原因

Gate2（agent_seal）允许主 agent 自己写审批文件，等价于没有独立审查。
核心问题：自评比第三方评分无价值——需要独立机器、独立账号、独立 LLM。

### 解决方案

1. **Brain 新增 `pr_review` task type**：路由到西安（xian），独立于美国主 agent
2. **`POST /tasks/:id/request-review`**：CI 通过后触发，创建 pr_review 任务
3. **execution-callback 解析 REVIEW_RESULT**：Xian Codex 输出写入 `review_result` 字段
4. **devloop-check.sh 条件 3.5**：等待 review 完成（PASS/FAIL）后才继续

### 下次预防

- [ ] agent_seal 文件审查：每次看到 `.dev-agent-seal` 文件，检查是否自写
- [ ] review_task_id 缺失时：检查 .dev-mode 是否有 brain_task_id
- [ ] migration 版本号：新 migration 前检查最新版本号（当前 155→156）
- [ ] 测试 3 处版本断言：desire-system.test.js + selfcheck.test.js + learnings-vectorize.test.js
