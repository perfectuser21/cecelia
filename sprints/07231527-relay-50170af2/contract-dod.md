# Contract DoD — Harness Kernel 有界运行与正确恢复

**TASK_ID**: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
**Sprint**: 07231527-relay-50170af2

---

## [BEHAVIOR] B-01：evidence_invalid 不进 generator-fix

evaluator callback 含 `failure_class: 'evidence_invalid'` 时，Kernel 路由到 `spawn:evaluator-evidence-repair`，不调用 `spawn:generator-fix`，fixRound 不递增。

**可验命令**：
```bash
# manual:bash
# 从 packages/brain 目录运行（vitest 在 packages/brain/node_modules/.bin/）
cd packages/brain && ./node_modules/.bin/vitest run \
  src/orchestrator/__tests__/derive.test.js \
  --reporter=verbose 2>&1 | grep -E "evidence_invalid|PASS|FAIL"
```

**预期**：`PASS` + 无 generator-fix intent

---

## [BEHAVIOR] B-02：同 SHA no-progress → terminal

generator-fix callback 的 `pr_head_sha` 与写入 intent 时的 `trigger_sha` 相同时，Kernel 立即写 `no_progress_same_sha` terminal，run.phase = 'failed'，不再派新 fix intent。

**可验命令**：
```bash
# manual:bash
# 从 packages/brain 目录运行
cd packages/brain && ./node_modules/.bin/vitest run \
  ../../sprints/07231527-relay-50170af2/tests/kernel-no-progress.test.js \
  --reporter=verbose 2>&1 | tail -15
```

**预期**：`PASS`，exitReason = 'no_progress_same_sha'

---

## [BEHAVIOR] B-03：120min 硬上限三道 fence 全接线

`harness-skill-relay.js` 建 run 时 `deadline_at = NOW() + INTERVAL '120 minutes'`。loop 的三道 deadline fence（collect 前 / derive 后 dispatch 前 / DONE 后）全部真实接线，任意 fence 触发均写 terminal 不 requeue。

**可验命令**：
```bash
# manual:bash
# 从 packages/brain 目录运行
cd packages/brain && ./node_modules/.bin/vitest run \
  ../../sprints/07231527-relay-50170af2/tests/kernel-deadline.test.js \
  --reporter=verbose 2>&1 | tail -15
```

**预期**：`PASS`，fence 1/2/3 各自 terminal

---

## [BEHAVIOR] B-04：failure_class 五类路由矩阵全覆盖

| failure_class | 预期路由 |
|---|---|
| product_failure | spawn:generator-fix |
| null/undefined（缺失） | spawn:generator-fix（保守） |
| evidence_invalid | spawn:evaluator-evidence-repair |
| environment_recovery（首次） | spawn:generator-fix |
| environment_recovery（第二次同签名） | mark_failed |
| needs_context | wait:human_review |
| contract_invalid | mark_failed |
| unknown | wait:human_review |

**可验命令**：
```bash
# manual:bash
# 从 packages/brain 目录运行
cd packages/brain && ./node_modules/.bin/vitest run \
  ../../sprints/07231527-relay-50170af2/tests/kernel-failure-class-routing.test.js \
  --reporter=verbose 2>&1 | tail -15
```

**预期**：`PASS`，8 个路由分支全覆盖

---

## [BEHAVIOR] B-05：持久化计数跨重启不归零

pollCount / blockedStreak 从 DB decision log 推导，Kernel 重启后恢复而非归零。wait:poll_ci 写 decision log（action='wait:poll_ci'）作为计数依据。

**可验命令**：
```bash
# manual:bash
# 从 packages/brain 目录运行
cd packages/brain && ./node_modules/.bin/vitest run \
  ../../sprints/07231527-relay-50170af2/tests/kernel-persistent-counters.test.js \
  --reporter=verbose 2>&1 | tail -15
```

**预期**：`PASS`，重启后 pollCount 从 DB 恢复

---

## [BEHAVIOR] B-06：approval bridge fail-closed + 认证全链

token 未配置 → 503；token 错误 → 401；旧 SHA 批准 → 409；重复批准 → 409；合法批准 → 写唯一 `verdict:human_review`，含 `approved: true`、`pr_head_sha`、`approved_by`。

**可验命令**：
```bash
# manual:bash
# 不需要真实 Brain 进程（单元测试检查源码结构）
cd packages/brain && ./node_modules/.bin/vitest run \
  ../../sprints/07231527-relay-50170af2/tests/kernel-approval-bridge.test.js \
  --reporter=verbose 2>&1 | tail -15

# 或直接 curl 验 fail-closed（Brain 未配 token 时）：
HARNESS_REVIEW_APPROVER_TOKEN="" node -e "
const res = await fetch('http://localhost:5221/api/brain/harness/pending-reviews/test-task/approve', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({approved_by: 'test'})
});
console.assert(res.status === 503, 'expected 503 got ' + res.status);
console.log('fail-closed OK');
"
```

**预期**：`PASS`，4 个拒绝场景 + 1 个成功场景全覆盖

---

## [BEHAVIOR] B-07：fixRound 只计产生新 SHA 的有效 product fix，上限 3

`counters.js` fixRound 只统计 `spawn:generator-fix` 且对应 callback `pr_head_sha !== trigger_sha` 的行。同 SHA no-progress 不计入。`MAX_FIX_ROUNDS = 3`，`MAX_HOPS = 60`。

**可验命令**：
```bash
# manual:bash
cd packages/brain && ./node_modules/.bin/vitest run \
  src/orchestrator/__tests__/constants.test.js \
  src/orchestrator/__tests__/counters.test.js \
  --reporter=verbose 2>&1 | grep -E "MAX_FIX_ROUNDS|MAX_HOPS|fixRound|PASS|FAIL"
```

**预期**：`PASS`，MAX_FIX_ROUNDS === 3，MAX_HOPS === 60，fixRound 计数正确

---

## [BEHAVIOR] B-08：d707 hop 55-66 replay 不产生重复 fix

使用真实 d707ae20 decision log fixture（hop 55-66），replay 后 hop 56（evidence_invalid）路由到 evidence-repair，hop 57（same SHA）terminal，不产生 hop 58-66 的 9 次重复 generator-fix。

**可验命令**：
```bash
# manual:bash
cd packages/brain && ./node_modules/.bin/vitest run \
  ../../sprints/07231527-relay-50170af2/tests/d707-replay.test.js \
  --reporter=verbose 2>&1 | tail -15
```

**预期**：`PASS`，replay 终止于 hop ≤ 58

---

## DoD 完成标准

- [ ] B-01 ~ B-08 全部测试先红后绿（commit 先跑红 → 修代码 → 再跑绿）
- [ ] `node scripts/facts-check.mjs` 通过
- [ ] `bash scripts/check-version-sync.sh` 通过
- [ ] `node packages/quality/scripts/devgate/check-dod-mapping.cjs` 通过
- [ ] DevGate 三检通过后方可 merge
- [ ] 独立 Codex 只读复审 PASS

---

## 优先级排序（先红后绿执行顺序）

1. d707 replay fixture 先红（T-04）
2. failure_class 路由先红后绿（T-01、T-10、T-11）
3. no-progress fence 先红后绿（T-02、T-03）
4. deadline + 重启计数先红后绿（T-05 ~ T-09）
5. approval bridge 全链（T-17）
6. orchestrator/watchdog/integration 全绿
7. DevGate 三检
