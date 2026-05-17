## v2 P2.5 外层 middleware 接线到 executeInDocker（2026-04-23）

### 根本原因

P2 PR1-11 建好 9 个 middleware，但只有内层 3 个（cascade/account-rotation/docker-run）真接到 executeInDocker。外层 4 个（cost-cap/logging/cap-marking/billing）躺着没起作用。P2.5 这一 PR 把外层接上：

```
executeInDocker(opts):
  logger.logStart()
  await checkCostCap(opts)            // 预算守卫，超预算抛
  writePromptFile + resolveCascade + resolveAccount  // 原有
  buildDockerArgs + cidfile 清理       // 原有
  result = await runDocker(...)
  await checkCap(result, opts)         // 429 检测 + markSpendingCap
  await recordBilling(result, opts)    // 写 dispatched_account 到 tasks.payload
  logger.logEnd(result)
  return result
```

中间不含真·attempt-loop for 循环（retry-circuit + cascade 维度循环），那是独立的下一个 PR。

### 下次预防

- [ ] **外层 middleware 接线是零行为改动**：cost-cap 在没 ctx.deps.getBudget 时 pass；cap-marking 只在 429 pattern 命中时 markSpendingCap；billing 在没 ctx.deps.updateTaskPayload 时 no-op；logging 纯日志。所以生产环境接上等于"观测上线"，不改功能
- [ ] **记得 ctx.deps 注入**：caller 要传预算 / DB writer 才能让 cost-cap 和 billing 起作用。默认不注入时 middleware 退化成 no-op，是设计好的容错路径
- [ ] **attempt-loop 真循环是下一步**：当前仍是 "一次 spawn 一个 attempt"。true for-loop 要在 spawn.js 层做（while over cascade × rotation），涉及 executeInDocker 接口变动
