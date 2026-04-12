### 根本原因

Evaluator E2 session 崩溃（result=null），Brain execution.js 默认判定 FAIL（防御性设计：宁可误杀不放过），派发 harness_fix R2。实际 active_pipelines 功能代码正确，三项 DoD 测试全部通过。

### 下次预防

- [ ] Evaluator session 崩溃时，Brain 应区分「session 崩溃」和「测试 FAIL」，避免误触 harness_fix
- [ ] eval-round-N.md 应在 harness_fix 启动时检查是否存在，若不存在且 failed_features=[] 则可能是 session 崩溃而非功能缺陷
