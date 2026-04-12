### 根本原因

harness_fix R41 任务被派发时，eval-round-41.md 文件不存在，pr_url 为 null。
实际上 feature（active_pipelines 字段）已在 PR #2282 合并，功能完全正常。
Brain 在 R8 PASS 后继续创建 fix 任务（R13、R41）是因为 harness run 的 pr_url 未正确回写到 planner task payload，导致后续 fix 轮次无法识别已完成状态。

### 下次预防

- [ ] Generator 完成后必须将 pr_url 回写到对应 run 的 planner task payload
- [ ] Evaluator 在判定 PASS 后应终止该 run，防止 Brain 继续创建 fix 任务
- [ ] harness_fix 任务创建前，应先检查 feature 是否已在 main 中存在
