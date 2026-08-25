# RED 证据 — commander lease 过期有界自动重派 [r75]

## 命令（改 derive.js 前，pre-fix 基线 base_sha=717d4e418）

```bash
npx vitest run --no-cache \
  sprints/08252100-kernel-r75-commander-retry/tests/commander-lease-expired-retry-bounded.test.ts \
  tests/gp/f1/step3-commander-lease-expired-retry.test.js \
  tests/gp/f1/step3-route-unknown-review-approve-consume.test.js \
  --reporter=dot
```

## 结果（RED）

```
 Test Files  3 failed (3)
      Tests  6 failed | 12 passed (18)
```

红的 6 条（pre-fix，commander 未纳入 infra 重试表 → 单条/少量过期仍挂 route_unknown 人审）：

- 冻结合同测试 `commander-lease-expired-retry-bounded.test.ts`
  - `单条 commander infra 过期（<上限）不再挂人审` → 现状 `wait:human_review`（红）
  - `边界 累计4条（第5条前）仍不挂人审` → 现状 `wait:human_review`（红）
- gp/f1 `step3-commander-lease-expired-retry.test.js`
  - `单条 commander infra 过期（<上限）不再挂人审`（红）
  - `边界 累计4条（第5条前）仍不挂人审`（红）
- 既有 #5058 `step3-route-unknown-review-approve-consume.test.js`（本 sprint 更新）
  - `r75 未达上限（单条 commander 过期，<5）→ 不再挂人审`（红）
  - `本地候选（pr=null）批准 → 候选头锚双匹配消费`（红 —— 消费末条 hop112 后，前序 hop109 未达上限本应重派，pre-fix 仍挂人审）

## GREEN 验证（应用 derive.js 有界重试实现后，本轮已本地验证过并回退）

```
 Test Files  3 passed (3)
      Tests  18 passed (18)
```

达上限 / 超上限 / 非 commander 角色 / commander 非 infra 失败四条负向在 pre-fix 即为绿（既有语义不变，本改动不回退），修后仍绿。

## R2 覆盖名解析自证（封印闸 assertTestContractResolvable 根除）

R1（封印码 FROZEN_CONTRACT_TEST_CONTRACT_UNRESOLVABLE）死因：Test Contract 表第 3 行两个覆盖名
`r75 未达上限（单条 commander 过期，<5）不再挂人审`、`本地候选（pr=null）批准 候选头锚双匹配消费`
遗漏了 `it()` 名里的 `→ ` 箭头，非连续子串，CI 同解析链解析不到 → 封印拒。R2 已补齐箭头。
以下逐条 `grep -F` 命中证明（每行覆盖名均为对应 `it()` 名字面子串）：

```
OK sprints/.../commander-lease-expired-retry-bounded.test.ts :: 单条 commander infra 过期（<上限）不再挂人审
OK sprints/.../commander-lease-expired-retry-bounded.test.ts :: 边界 累计4条（第5条前）仍不挂人审
OK tests/gp/f1/step3-commander-lease-expired-retry.test.js :: 单条 commander infra 过期（<上限）不再挂人审
OK tests/gp/f1/step3-commander-lease-expired-retry.test.js :: 边界 累计4条（第5条前）仍不挂人审
OK tests/gp/f1/step3-commander-lease-expired-retry.test.js :: 达上限 第5条expired
OK tests/gp/f1/step3-commander-lease-expired-retry.test.js :: 超上限 第6条expired
OK tests/gp/f1/step3-commander-lease-expired-retry.test.js :: 负向 非commander角色（planner）infra过期语义不变
OK tests/gp/f1/step3-commander-lease-expired-retry.test.js :: 负向 commander非infra失败（account_exhausted）语义不变
OK tests/gp/f1/step3-route-unknown-review-approve-consume.test.js :: 达重试上限（5 条 expired）route_unknown 决策对象带 callbackHop
OK tests/gp/f1/step3-route-unknown-review-approve-consume.test.js :: r75 未达上限（单条 commander 过期，<5）→ 不再挂人审
OK tests/gp/f1/step3-route-unknown-review-approve-consume.test.js :: 本地候选（pr=null）批准 → 候选头锚双匹配消费
```

测试文件本体、derive.js 实现口径、DoD 断言 R1→R2 一字未改（R1 已 7 维 APPROVED），仅表格覆盖名补 `→ `。
