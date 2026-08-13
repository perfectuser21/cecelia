# Contract DoD — Harness 入口旁路修复：kernel-v1 绕过 Session Controller 门禁

## 判定点总数：4

---

## 判定点清单

### DOD-1：executor 白名单校验覆盖 kernel-v1 路径（INV-6）

**验收命令**：
```bash
cd /workspace && node packages/brain/node_modules/.bin/vitest run \
  --config packages/brain/vitest.integration.config.js \
  packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  --reporter verbose 2>&1 | grep -E "INV-6|executor.*auto|unsupported executor"
```

**通过标准**：
- [ ] 测试用例 `INV-6: executor='auto' + kernel-v1 → 白名单拦截 + initiative_runs count=0` 通过
- [ ] 返回值为 `{ok: false, error: 'unsupported executor: auto'}`
- [ ] 真实 DB initiative_runs 对该 task_id 的 count = 0
- [ ] 测试中未 mock `pool.query` 或 `createKernelRun`

**失败标准**（任意一条失败即 REJECT）：
- 测试超时或抛出未预期错误
- DB 出现意外 run 行（count > 0）
- 测试使用 `vi.mock` 替身被改边

---

### DOD-2：DB 幂等防重覆盖 kernel-v1 路径（INV-5）

**验收命令**：
```bash
cd /workspace && node packages/brain/node_modules/.bin/vitest run \
  --config packages/brain/vitest.integration.config.js \
  packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  --reporter verbose 2>&1 | grep -E "INV-5|active_run_guard|幂等防重"
```

**通过标准**：
- [ ] 测试用例 `INV-5: 活跃 run 存在 + kernel-v1 重打 → DB 幂等防重` 通过
- [ ] 返回值为 `{ok: false, deferred: true, reason: 'active_run_guard'}`
- [ ] DB initiative_runs count 仍为 1（不新增 run）
- [ ] 测试中未 mock `findActiveRunBlockingSpawn`

**失败标准**：
- 返回 `{ok: true}` 或创建了第二条 run
- 测试使用 stub 替换 `findActiveRunBlockingSpawn`

---

### DOD-3：合法路径 + kernel-v1 → controller_session_id 非空（INV-1 + INV-8）

**验收命令**：
```bash
cd /workspace && node packages/brain/node_modules/.bin/vitest run \
  --config packages/brain/vitest.integration.config.js \
  packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  --reporter verbose 2>&1 | grep -E "合法路径|controller_session_id|INV-1|INV-8"
```

**通过标准**：
- [ ] 测试用例 `合法路径 + kernel-v1 → controller_session_id 非空` 通过（或已有测试回归通过）
- [ ] 返回 `{ok: true, mode: 'kernel-v1'}`
- [ ] DB 中 controller_session_id IS NOT NULL 且非空串
- [ ] controller_lease_expires_at > started_at

**失败标准**：
- 合法路径被 executor 白名单误拦截
- controller_session_id 为 NULL

---

### DOD-4：createKernelRun 无 controllerSessionId → fail-closed 回归（INV-4）

**验收命令**：
```bash
cd /workspace && node packages/brain/node_modules/.bin/vitest run \
  --config packages/brain/vitest.integration.config.js \
  packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  --reporter verbose 2>&1 | grep -E "fail-closed|missing controller|INV-4"
```

**通过标准**：
- [ ] 现有测试 `createKernelRun 无 controllerSessionId fail-closed` 仍通过（回归不破坏）
- [ ] 抛出错误匹配 `/missing controller ownership/`
- [ ] DB count = 0

**失败标准**：
- 现有 fail-closed 测试因本次改动被破坏
- 错误信息变更（regression）

---

## 整体 DevGate 校验

```bash
# DevGate 三道闸（Brain 代码改动前必须全通）
node /workspace/scripts/facts-check.mjs
bash /workspace/scripts/check-version-sync.sh
node /workspace/packages/quality/scripts/devgate/check-dod-mapping.cjs
```

**通过标准**：三道命令全部 exit 0

---

## 铁律覆盖检查

| 铁律 | 验证方式 | 通过标准 |
|---|---|---|
| fail-closed（AP-1） | DOD-1 DB count=0 | initiative_runs 无意外行 |
| 幂等（AP-2） | DOD-2 DB count 不增 | 第二次 spawn 被拒绝 |
| 可观测（AP-1 日志） | grep `[skill-relay][ALERT]` | 日志确认打出 |
| 禁 mock 被改边 | 机械 grep vi.mock | 集成测试文件无 vi.mock pool/createKernelRun/findActiveRunBlockingSpawn |
| 回归不破坏（AP-4） | DOD-4 现有测试通过 | PR #4860 行为不退化 |

---

## 判定结论格式

```
APPROVED / REVISION

判定点通过: X/4
铁律覆盖: Y/5

未通过判定点:
- DOD-N: <原因>

必须修复后重新提交 contract review。
```

---

## 附：集成测试文件路径

- `packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js`（在此文件追加 INV-5 + INV-6 两个用例）

## 附：单测文件路径（可选补充）

- `packages/brain/src/__tests__/harness-skill-relay.test.js`（可在此追加 fake-deps 快速验证白名单 + 幂等 mock 路径）
