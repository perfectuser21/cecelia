# Learning: 执行日志记录器 + 真实质检报告

## 分支
`cp-03192059-execution-log-quality-report`

### 根本原因

Engine 有三套报告机制但全是空壳：
1. `generate-report.sh` 读 `.quality-report.json`（从没人写这个文件）→ L1/L2/L3 全是 unknown
2. `generate-feedback-report-v2.sh` 读 `.dev-execution-log.jsonl`（从没人写这个文件）→ 从未被调用
3. Step 5.0 四维评分写在文档里但无强制执行

核心问题：**验证层（verify-step.sh）和状态机（devloop-check.sh）有 pass/fail 判断，但不持久化历史**。所有信息随会话结束消失。

### 下次预防

- [ ] 新增需要数据源的报告系统时，必须同时实现数据写入端——不能只建消费端
- [ ] jq `-s` slurp 模式下的 `as $var` 绑定会改变管道上下文，复杂 jq 需先用 `. as $all` 保存原始数据
- [ ] jq 评分计算 `(expr) | ... as $score` 中，`as` 前面的整个表达式必须用括号包裹，否则管道值变成数字而非原始对象
