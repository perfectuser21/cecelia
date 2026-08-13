# Contract DoD: Preview 主 Tick 隔离修复

**Task ID**: 85d959e8-569e-4a17-a98f-229c71e14e6d

---

## 行为断言

[BEHAVIOR] B-1: `initTickLoop()` 在 `process.env.BRAIN_PREVIEW === '1'` 时返回 `{success:true,enabled:false,loop_running:false,preview:true}`，且 `startTickLoop` 不被调用

[BEHAVIOR] B-2: `tryRecoverTickLoop()` 在 `process.env.BRAIN_PREVIEW === '1'` 时，清除 recoveryTimer 后 return，`startTickLoop` 不被调用

[BEHAVIOR] B-3: `initTickLoop()` 在 BRAIN_PREVIEW=1 时调用 `tickLog`/`console.log` 且输出包含字符串 `"BRAIN_PREVIEW"`

[BEHAVIOR] B-4: `BRAIN_PREVIEW` 未设置时，`initTickLoop()` 在 DB `tick_enabled=true` 时调用 `startTickLoop()`（现有行为零回归）

## DoD 检查清单

- [ ] `packages/brain/src/tick-recovery.js` 的 `initTickLoop` 已加 BRAIN_PREVIEW 守卫
- [ ] `packages/brain/src/tick-recovery.js` 的 `tryRecoverTickLoop` 已加 BRAIN_PREVIEW 守卫
- [ ] `packages/brain/src/__tests__/tick-recovery-preview.test.js` 含 4 个对应用例（B-1 ~ B-4）
- [ ] `vitest run packages/brain/src/__tests__/tick-recovery-preview.test.js` 全绿
- [ ] 现有测试套件零回归（`vitest run packages/brain` 全通）

## 验收命令

manual:bash
```bash
cd /workspace && npm run test --workspace=packages/brain -- --run packages/brain/src/__tests__/tick-recovery-preview.test.js 2>&1 | tail -20
```

## 判定点登记表

| 判定点 | 预期 | 实际（填写后） |
|---|---|---|
| B-1 initTickLoop BRAIN_PREVIEW=1 早返回 + preview:true | PASS | — |
| B-2 tryRecoverTickLoop BRAIN_PREVIEW=1 跳过 | PASS | — |
| B-3 BRAIN_PREVIEW 日志输出 | PASS | — |
| B-4 非 Preview startTickLoop 正常调用（零回归） | PASS | — |
