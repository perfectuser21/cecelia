# Red Evidence — diagnostic 人审消费 [r49]

TDD Red 阶段：正向消费用例 FAIL（derive 仍返回 wait:human_review），三条守卫用例 PASS。
预期红证据（Test Contract）：1 failed / 3 passed。

```
     → expected 'wait:human_review' not to be 'wait:human_review' // Object.is equality
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  sprints/08221753-kernel-dd912609/tests/diagnostic-human-review-consume.test.js > diagnostic 人审消费 > diagnostic 人审批准后 derive 消费该批准并重试原动作，不再 wait:human_review
AssertionError: expected 'wait:human_review' not to be 'wait:human_review' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```
