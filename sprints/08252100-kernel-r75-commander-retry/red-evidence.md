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
