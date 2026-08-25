# RED 证据 — commander lease 过期有界自动重派 [r75]

## 冻结合同测试初始状态（未改 derive.js 前，真 import derive() 重放）

frozen: sprints/08252100-kernel-r75-commander-retry/tests/commander-lease-expired-retry-bounded.test.ts
gp-f1:  tests/gp/f1/step3-commander-lease-expired-retry.test.js
consume: tests/gp/f1/step3-route-unknown-review-approve-consume.test.js

未修复前直接调 derive(baseObserved({ decisionLog })) 的实测输出：

```
n=1: action=wait:human_review reason=callback_infrastructure_route_unknown callbackHop=103
n=4: action=wait:human_review reason=callback_infrastructure_route_unknown callbackHop=109
n=5: action=wait:human_review reason=callback_infrastructure_route_unknown callbackHop=112
n=6: action=wait:human_review reason=callback_infrastructure_route_unknown callbackHop=114
```

- 未达上限（n=1 / n=4）本应「不挂人审」→ 修前仍 wait:human_review ⇒ 红。
  · frozen「单条 commander …不再挂人审」+「边界 累计4条…仍不挂人审」= 2 failed
  · gp-f1 同名两用例 = 2 failed
  · consume「r75 未达上限（单条 commander 过期，<5）→ 不再挂人审」+「本地候选…批准 → 候选头锚双匹配消费」= 2 failed
- 达上限（n=5 / n=6）修前即已 wait+callbackHop（这两条修后语义不变，非红）。

预期红证据与合同 Test Contract 一致：三文件各 → 2 failed。

## GREEN（修 derive.js 后）

```
n=1: action=spawn:judge reason=evaluate_passed_awaiting_judge callbackHop=undefined
n=4: action=spawn:judge reason=evaluate_passed_awaiting_judge callbackHop=undefined
n=5: action=wait:human_review reason=callback_infrastructure_route_unknown callbackHop=112
n=6: action=wait:human_review reason=callback_infrastructure_route_unknown callbackHop=114
```

三文件全绿：Tests 18 passed（3 文件共 18 用例）。
