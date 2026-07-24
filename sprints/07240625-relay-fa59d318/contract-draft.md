# Contract Draft: headless-smoke

**Task ID**: fa59d318-89ca-4b13-bee5-93cdf8c4362e
**Sprint Dir**: sprints/07240625-relay-fa59d318
**Date**: 2026-07-23
**Status**: DRAFT
**verification_level: L3** (real-Brain-API: http://localhost:5221, 对真实运行中的 Brain 服务验证，非 mock/stub/离线)

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| headless dispatch smoke A1-A5+sad path | `../../tests/regression/relay-fa59d318/headless-smoke.test.sh` | B1/B2/B3/B4/B5/B6/B7 | → 实现前 headless-smoke.sh 未就位时全部断言失败 |

### BEHAVIOR 判定点明细

| # | [BEHAVIOR] 判定点 | 验证方式 | 分类 | 预期结果 |
|---|-----------------|---------|------|---------|
| B1 | [BEHAVIOR] GET /healthz 返回 HTTP 200 | curl -s -o /dev/null -w "%{http_code}" | happy path | 200 |
| B2 | [BEHAVIOR] POST /api/brain/tasks(mode=headless, executor=claude, orchestrator=skill-relay) 返回 200/201 且响应体含 `id` 字段 | curl + python3 JSON 解析 | happy path | 200 or 201, id 为 string |
| B3 | [BEHAVIOR] GET /api/brain/tasks/{id} 读回任务，payload.mode 字段值为 "headless" | curl + python3 断言 | happy path | payload.mode == "headless" |
| B4 | [BEHAVIOR] `packages/brain/src/executor-contracts.js` 包含 `harness_initiative → relay-container` 静态映射（I-01 不变式） | python3 读文件 + 字符串断言 | happy path（静态代码断言） | 文件含 harness_initiative 且同上下文含 relay-container |
| B5 | [BEHAVIOR] PATCH 两步清理：queued→in_progress（200），再 in_progress→failed（200） | curl -w "%{http_code}" | happy path | 200 |
| B6 | [BEHAVIOR] POST tasks 后读回任务 title 与探针 title "headless-smoke-probe-test" 一致（可重入身份确认） | python3 字段比对 | happy path | title == "headless-smoke-probe-test" |
| B7 | [BEHAVIOR] Brain 不可达时脚本以非零退出码退出（防假绿） | BRAIN_URL=http://localhost:0 bash headless-smoke.sh | sad path | exit code != 0 |

### Sad Path 补充

| # | 场景 | 预期 |
|---|------|------|
| SP1 | Brain /healthz 返回非 200 | 脚本立即退出，FAIL=1 |
| SP2 | POST tasks 返回非 200/201 | 脚本记录失败，FAIL++ |
| SP3 | id 为空（Brain 响应格式错误） | python3 exit 1，脚本记录失败 |
| SP4 | executor-contracts.js 缺少 harness_initiative→relay-container 映射 | python3 断言失败，违反 I-01 不变式 |

---

## E2E 验收

验收方式: `manual:bash`

```bash
# 前提: Brain 已在 localhost:5221 运行
cd /workspace
bash packages/brain/scripts/smoke/headless-smoke.sh
```

预期输出（最后两行）：
```
PASS: 5  FAIL: 0
✅ 全部通过
```

或：
```bash
# 以自定义 Brain URL 运行
BRAIN_URL=http://localhost:5221 bash packages/brain/scripts/smoke/headless-smoke.sh
```

**判定标准**：exit code = 0 且 FAIL: 0。

---

## 未覆盖真实链路清单

| 链路 | 说明 | 风险等级 |
|------|------|---------|
| executor 实际启动容器 | smoke 只验 API 层路由，不验 relay-container 真实拉起 | 低（有专项 relay smoke 覆盖） |
| DB 持久化后 tick 捡走 | PATCH status=failed 前若 tick 恰好捡走探针，可能干扰 | 低（标题 "headless-smoke-probe-test" 区分） |

---

## 判定点登记表

| ID | [BEHAVIOR] 标签 | 覆盖断言 | 对应 PRD |
|----|----------------|---------|---------|
| B1 | GET /api/brain/healthz → 200 | A1 | A1 |
| B2 | POST tasks → 200/201 + id | A2 | A2 |
| B3 | payload.mode == "headless" | A3 | A3 |
| B4 | executor-contracts.js 含 harness_initiative→relay-container 静态映射 | A4（静态断言） | A4 |
| B5 | PATCH status=failed → 200 | A5 | A5 |
| B6 | title 可重入一致性 | NFR-03 | NFR-03 |
| B7 | Brain 不可达 → 非零退出 | sad path | NFR-02 |
