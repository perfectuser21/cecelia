# Red 证据 — commander lease 过期有界自动重派 [r74]

## 未实现前（当前 unfixed derive.js）三测试文件 RED 基线

命令：
```
npx vitest run \
  sprints/08251745-kernel-r74-commander-retry/tests/commander-infra-retry-bounded.test.ts \
  tests/gp/f1/step3-commander-infra-retry-bounded.test.js \
  tests/gp/f1/step3-route-unknown-review-approve-consume.test.js --reporter=dot
```

输出：
```
 ❯ sprints/08251745-kernel-r74-commander-retry/tests/commander-infra-retry-bounded.test.ts  (6 tests | 2 failed)
 ❯ tests/gp/f1/step3-route-unknown-review-approve-consume.test.js  (6 tests | 2 failed)
 ❯ tests/gp/f1/step3-commander-infra-retry-bounded.test.js  (6 tests | 2 failed)
 Test Files  3 failed (3)
      Tests  6 failed | 12 passed (18)
```

RED 用例（修前 commander 不在重试表 → 单条/少量过期即 wait:human_review）：
- 单条 commander infra 过期（<上限）不再挂人审 → 修前 `expected 'wait:human_review' not to be 'wait:human_review'`
- 边界 累计4条（第5条前）仍不挂人审 → 修前同上
- （#5058）r74 未达上限（单条 commander 过期，<5）→ 不再挂人审 → 修前红
- （#5058）本地候选（pr=null）批准 → 候选头锚双匹配消费，不再 wait → rebase 到达上限（5 条）后，approve 消费末条 hop112 → 前序 hop109（序号4<5）修前仍 wait，修后重派，修前红

GREEN 用例（fail-closed / 负向语义，修前修后一致）：达上限第5条 wait+callbackHop=112、超上限第6条仍 wait、非commander(planner)重派、commander account_exhausted route_unknown 不变。

## 修法验证（临时打补丁本地实证，已回滚，实现交 Generator）

在 `attemptCallbackRoute` infra 分支加 `role==='commander' && commanderInfraExpiryOrdinal(log, row.hop) < COMMANDER_INFRA_RETRY_CAP → return null`，并加 `COMMANDER_INFRA_RETRY_CAP=5` + 序号计数纯函数后：
```
 Test Files  3 passed (3)
      Tests  18 passed (18)
```
brain 编排器既有 `src/orchestrator/__tests__/derive.test.js` + `loop.test.js`：`181 passed`（零回归）。
（唯一 gp/f1 失败 `step3-publisher-head-lag-retry.test.js` 为 git 沙箱 frozen_baseline 环境问题，unpatched 基线上同样失败，与本变更无关。）

补丁已 `git checkout` 回滚；Generator 负责真实落地实现 + 版本四处 bump + 勾选 DoD。
