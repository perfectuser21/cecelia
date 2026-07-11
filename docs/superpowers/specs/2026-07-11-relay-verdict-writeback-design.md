# 设计：PATCH relay-runs 接住 controller 已在发送的 verdict/cost（裁决结构化回写）

日期：2026-07-11 ｜ Brain task：548c8d1e ｜ decision：833d051e ｜ sprint：sprints/07110840-p1-verdict-writeback

## 根因（已实锤）
读写分裂：PR #3540 只给 GET 列表/详情端点补了 verdict/cost 字段；harness-controller v1.3.0 起终局上报 `PATCH /api/brain/orchestrator/relay-runs/:initiative_id` 已发送 `{"phase":"done","verdict":"PASS","cost":<N>,"pr_url":...}`，但 handler（packages/brain/src/routes/initiatives.js:405）只解构 `{phase, failure_reason, pr_url}`，verdict/cost 被静默丢弃。结果：initiative_runs 全库 judge_verdict/evaluate_verdict NULL、v2 行 cost_usd 全 0；gates.js/mergeGate 读方与 skill 自我进化（蓝图 P1）都没有基准线。

## 修法（单文件，initiatives.js PATCH handler）
新增三个**可选、best-effort** 字段，与 phase 校验解耦：

| body 字段 | 归一化 | 合法值 | 落列 |
|---|---|---|---|
| `verdict` | trim+大写 | PASS / FAIL | judge_verdict（controller 语义=终裁） |
| `evaluate_verdict` | trim+大写 | PASS / FAIL / FIXED | evaluate_verdict（预留，当前无发送方） |
| `cost` | Number() | 有限数字且 ≥0 | cost_usd |

- **铁律（对抗审查 BLOCKER-1）**：这三个字段非法（含类型不对/归一后仍不在枚举）→ **忽略该字段 + console.warn + 响应体 `warnings[]`，绝不 400**——否则 LLM 现填的占位值会把 `phase=done` 终态一起打回，watchdog（`phase NOT IN ('done','failed')` 判据）重点火双 spawn，这是比丢数据更重的回归。phase/pr_url 现有校验行为不变。
- 写入语义与 failure_reason/pr_url 一致：`COALESCE($n, col)`——提供即覆盖（fix 循环后 FAIL→PASS 需要覆盖），缺省保持。
- RETURNING 补 evaluate_verdict/judge_verdict/cost_usd。
- 存量 NULL 不回填。

## 明确不做
- 不改 harness-controller skill（它发的 `verdict`/`cost` 字段名就是本次接住的名字；`evaluate_verdict` 发送方留给后续 skill bump）。
- 不动 orchestrator v2 loop/gates（读方）。
- 不做 cost 跨 subagent 聚合校准（NUMERIC(8,2) 上限足够）。

## 测试策略（integration 档：supertest + mock pool，套路同 relay-v101.test.js，断言 SQL 参数投影防假绿）
新文件 `packages/brain/src/__tests__/relay-runs-verdict-writeback.test.js`：
1. PATCH `{phase:"done",verdict:"PASS",cost:1.23,pr_url}` → 200，UPDATE 参数含 'PASS' 与 1.23，SQL 含 judge_verdict/cost_usd
2. 小写 `verdict:"pass"` → 归一 'PASS' 写入
3. 非法 `verdict:"MAYBE"` + 合法 phase → **200**，judge_verdict 参数为 null（字段被忽略），响应含 warnings
4. `cost:"1.23"`（字符串数字）→ 1.23 写入；`cost:-1` → 忽略
5. `evaluate_verdict:"FIXED"` → 写入
6. 不带新字段 → 参数为 null、行为与现状一致（防回归；另有 relay-v101.test.js 兜底，其 params.toContain 断言不受追加参数影响——对抗审查第 1 项已核）
守卫定性：逻辑接缝 → CI regression test 即守卫；commit-1 红测 proven-to-fire。

## 风险与边界
- 已核无其他 PATCH 调用方（watchdog 只 SELECT；judge API 不碰 initiative_runs）、无在飞 PR 冲突（对抗审查第 1/4 项）。
- 已知语义瑕疵（接受）：GAN 阶段终局失败 controller 也发 verdict:FAIL → judge 未跑的 run 记 judge_verdict='FAIL'，记录不精确但方向正确。
- `relay-runs-verdicts.test.js` 的过时 fixture 不打真库，落地时跑全套确认不破。
