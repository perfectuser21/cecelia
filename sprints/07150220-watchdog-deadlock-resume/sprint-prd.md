# Sprint PRD：watchdog 死局解除（07150220）

**Task ID**: d3343415-8ff6-427c-b867-8d36faa54448
**Sprint Dir**: sprints/07150220-watchdog-deadlock-resume
**Target**: local_api
**Date**: 2026-07-14

---

## 背景与症状

07-14 三次实证：session 死于 CI 红后陷入死局——PR OPEN → watchdog 跳过重点火（当前 `OPEN` 直接 `continue`）→ CI 无人修 → 干等 6h deadline。

- 第 2 发（#3875 Preview 抖动）与第 4 发（#3904 BEHIND+多项红）均靠人工 update-branch/回队救活。
- 复活 session 经 controller Step 0.4 均正确续跑原 PR，**未产生重复 PR**——证明重点火续跑安全。

**根因**：`resumeStalledRelayRuns` 在容器消失 + PR OPEN 时无条件跳过，未区分"CI 红（需要 agent 修复）"和"CI 跑中/全绿（等待 merge）"两种状态。

---

## 目标

扩展 watchdog 的 OPEN PR 处理逻辑：

- `OPEN + mergeStateStatus=BEHIND` → 重点火（需 update-branch）
- `OPEN + CI 含 FAILURE` → 重点火（需 agent 修 CI）
- `OPEN + CI pending/running` → 继续等（不重点火）
- `OPEN + CI 全绿 + mergeState 非 BEHIND` → 继续等（当前行为保留）

---

## Golden Path（4 条必须有测试）

### GP-1：OPEN + BEHIND → 重点火
**条件**：容器消失 + `gh pr view` 返回 `state=OPEN` + `mergeStateStatus=BEHIND`
**期望**：`spawnFn` 被调用一次，`out.resumed++`，日志含 `resume_ci_red` 或相应标签

### GP-2：OPEN + CI FAILURE → 重点火
**条件**：容器消失 + `state=OPEN` + `mergeStateStatus=CLEAN`（非 BEHIND）+ `gh pr checks` 含 `state=FAILURE`
**期望**：`spawnFn` 被调用一次，`out.resumed++`，日志含 `resume_ci_red`

### GP-3：OPEN + CI pending/running → 跳过
**条件**：容器消失 + `state=OPEN` + `gh pr checks` 全部 `state=IN_PROGRESS/PENDING`（无 FAILURE）
**期望**：`spawnFn` 不被调用，`out.resumed===0`，日志含 `wait_ci_running`

### GP-4：attempt cap → 不再点火（回归）
**条件**：`attempts >= MAX_RELAY_ATTEMPTS`，PR OPEN + BEHIND
**期望**：`spawnFn` 不被调用，`out.capped` 增加（既有熔断不回归）

---

## 验收标准

### 功能验收
- [ ] GP-1 ~ GP-4 测试全部通过（failing test 先 commit，修复后再绿）
- [ ] 既有 `harness-relay-watchdog.test.js` 所有用例继续通过（无回归）
- [ ] `OPEN + CI 全绿 + 非 BEHIND` → 跳过行为不变（现有 test case 覆盖）

### 实现约束
- CI 状态判断**复用 `ground-truth.js` 的 `mapCiStatus`**（或等价的 `gh pr checks --json state` 调用），不重复造轮子
- `mergeStateStatus` 通过扩展现有 `gh pr view` 的 `--json` 字段获取（已有 `state` 字段，追加 `mergeStateStatus`）
- 重点火**走既有 `spawnSkillRelaySession`**（即 `deps.spawnFn`），禁止自造 spawn
- 日志三种决策明确区分：
  - `resume_ci_red`（BEHIND 或 CI FAILURE → 重点火）
  - `wait_ci_running`（CI 跑中/pending → 等待）
  - `skip_green_waiting_merge`（CI 全绿 + 非 BEHIND → 等待 merge）

### 铁律（不可触碰）
- 不改 `MAX_RELAY_ATTEMPTS` / `MAX_CODEX_RELAY_ATTEMPTS` 数值
- 不动 MERGED / CLOSED 分支逻辑
- 不碰 headed 分支（`_handleHeadedRun`）
- 不碰 `foreground` orchestrator_host 护栏

---

## 实现路径

### 变更文件
- `packages/brain/src/harness-relay-watchdog.js`：主逻辑（OPEN 分支内新增 CI 状态检查）
- `packages/brain/src/__tests__/harness-relay-watchdog.test.js`：新增 GP-1 ~ GP-4 测试

### 关键改动点（伪代码）

当前（`harness-relay-watchdog.js` ~L291-L294）：
```js
if (prState === 'OPEN') {
  console.log(`[relay-watchdog] PR 仍 OPEN，等 CI/merge → 跳过重点火 ...`);
  continue;
}
```

目标改为：
```js
if (prState === 'OPEN') {
  // 查 mergeStateStatus 和 CI checks
  const prDetail = JSON.parse(execFn(`gh pr view "${effectivePrUrl}" --json state,mergeStateStatus`));
  const checkRows = asJson(execTolerant(execFn, `gh pr checks "${effectivePrUrl}" --json state`)) ?? [];
  const ciStatus = mapCiStatus(checkRows);  // 复用 ground-truth 逻辑

  const isBehind = prDetail.mergeStateStatus === 'BEHIND';
  const isCiFail = ciStatus === 'fail';

  if (isBehind || isCiFail) {
    // 需要 agent 介入 → 重点火
    console.log(`[relay-watchdog] resume_ci_red initiative=... reason=${isBehind ? 'BEHIND' : 'CI_FAILURE'}`);
    // → fall through to spawn logic below
  } else if (ciStatus === 'pending') {
    console.log(`[relay-watchdog] wait_ci_running initiative=...`);
    continue;
  } else {
    // CI 全绿 + 非 BEHIND → 等 merge
    console.log(`[relay-watchdog] skip_green_waiting_merge initiative=...`);
    continue;
  }
}
```

注意：`mapCiStatus` 在 `ground-truth.js` 中未导出——实现时可选择：
1. 从 `ground-truth.js` 导出 `mapCiStatus`（推荐，符合"不重复造轮子"）
2. 在 `harness-relay-watchdog.js` 内用等价逻辑内联（可接受）

---

## 测试设计（新增 4 条）

文件：`packages/brain/src/__tests__/harness-relay-watchdog.test.js`

```js
// GP-1
it('容器消失 + PR OPEN + mergeStateStatus=BEHIND → 重点火（resume_ci_red）', async () => {
  const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'BEHIND', ciChecks: [] });
  const r = await resumeStalledRelayRuns(deps);
  expect(deps.spawnFn).toHaveBeenCalledOnce();
  expect(r.resumed).toBe(1);
});

// GP-2
it('容器消失 + PR OPEN + CI FAILURE → 重点火（resume_ci_red）', async () => {
  const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN',
    ciChecks: [{ state: 'FAILURE' }] });
  const r = await resumeStalledRelayRuns(deps);
  expect(deps.spawnFn).toHaveBeenCalledOnce();
  expect(r.resumed).toBe(1);
});

// GP-3
it('容器消失 + PR OPEN + CI pending → 跳过（wait_ci_running）', async () => {
  const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'CLEAN',
    ciChecks: [{ state: 'IN_PROGRESS' }] });
  const r = await resumeStalledRelayRuns(deps);
  expect(deps.spawnFn).not.toHaveBeenCalled();
  expect(r.resumed).toBe(0);
});

// GP-4（回归）
it('PR OPEN + BEHIND + attempts >= 上限 → 不重点火（熔断优先）', async () => {
  const deps = makeDeps({ prUrl: PR_URL, prState: 'OPEN', mergeStateStatus: 'BEHIND',
    ciChecks: [], attempts: MAX_RELAY_ATTEMPTS });
  const r = await resumeStalledRelayRuns(deps);
  expect(deps.spawnFn).not.toHaveBeenCalled();
  expect(r.capped).toBe(1);
});
```

`makeDeps` 需扩展 `mergeStateStatus` 和 `ciChecks` 参数，并在 `execFn` mock 中对 `gh pr checks` 返回对应 JSON。

---

## Invariants（不可违反）

1. **熔断优先**：`attempts >= cap` 时，无论 PR 状态如何，不重点火
2. **MERGED 路径不变**：PR MERGED 直接走 `_finalizeMergedRun`，不受本次改动影响
3. **CLOSED 路径不变**：PR CLOSED 走原逻辑（attempt cap → 重点火），不受本次改动影响
4. **headed 不受影响**：`_handleHeadedRun` 逻辑完全不动
5. **foreground 护栏不受影响**：`orchestrator_host=foreground` 跳过逻辑完全不动
6. **spawnFn 唯一来源**：`deps.spawnFn || import(harness-skill-relay).spawnSkillRelaySession`，禁止新增 spawn 路径
7. **CI 判断不重造轮子**：必须复用 `mapCiStatus` 逻辑（导出或内联等价实现）
8. **失败保守跳过**：`gh pr checks` 调用失败时，保守跳过不重点火（等价于现有 `gh pr view` 失败处理）

---

## 累积 FR（Functional Requirements）

| # | 描述 | 来源 |
|---|------|------|
| FR-01 | OPEN + BEHIND → 重点火 | PrepPRD GP-1 |
| FR-02 | OPEN + CI FAILURE → 重点火 | PrepPRD GP-2 |
| FR-03 | OPEN + CI pending/running → 等待，不重点火 | PrepPRD GP-3 |
| FR-04 | attempt cap 在 BEHIND/FAILURE 下仍生效 | PrepPRD GP-4 / 铁律 |
| FR-05 | 日志区分 resume_ci_red / wait_ci_running / skip_green_waiting_merge | PrepPRD 验收标准 |
| FR-06 | CI 判断复用 mapCiStatus 逻辑，不重复造轮子 | PrepPRD 铁律 |
| FR-07 | 重点火走既有 spawnSkillRelaySession | PrepPRD 铁律 |
| FR-08 | MERGED / CLOSED / headed / foreground 路径完全不动 | PrepPRD 铁律 |

---

## 开发顺序

1. **先写 failing tests**（GP-1 ~ GP-4）→ commit
2. 扩展 `makeDeps`（增加 `mergeStateStatus` / `ciChecks` mock 参数）
3. 修改 `harness-relay-watchdog.js`（OPEN 分支细化）
4. 导出或内联 `mapCiStatus`
5. 运行全量测试：`pnpm --filter brain test harness-relay-watchdog`
6. 确认既有 8 条 watchdog 测试全绿
7. PR → CI 全绿 → merge

---

## NFR

N/A（纯逻辑修复，无性能 / 可用性 NFR）

---

journey_type: bug_fix
target_environment: local_api
status: completed (merged 2026-07-15T01:48:23Z, pr=#3940)
