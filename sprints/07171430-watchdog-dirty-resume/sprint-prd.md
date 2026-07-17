# Sprint PRD: watchdog DIRTY resume 补丁

- **Task ID**: c6a171e5-1a9c-4058-8364-abd946daccae
- **Sprint Dir**: sprints/07171430-watchdog-dirty-resume
- **日期**: 2026-07-17
- **Gear**: hotfix
- **Target Env**: local_api
- **Review Required**: false
- **父路 PRD**: docs/prd/2026-07-15-self-healing-golden-path.prd.md（自愈链 S3 分支路由）

---

## 1. 问题陈述（实证）

**事故时间**: 2026-07-17 14:1x  
**PR**: #4023  
**根因**:  
`mergeStateStatus=DIRTY`（存在合并冲突，容器已消失）时，watchdog 的判定逻辑漏掉了 DIRTY 分支：

```
packages/brain/src/harness-relay-watchdog.js L413：
if (isBehind || ciStatus === 'fail') {
  // BEHIND 或 CI 红 → 重点火
} else if (ciStatus === 'pending') {
  // CI 跑中 → wait_ci_running（干等）⚠ DIRTY 在这里被错误归类
} else {
  // CI 全绿 → 等 merge
}
```

DIRTY 状态下 CI 永不完整，`ciStatus` 落入 `pending`，watchdog 打 `wait_ci_running` 干等，
永远等不来 CI 完整信号 → 任务卡死，需人工干预（本次为第 4 次人工救场）。

**自愈链映射**: S3 对因处置分支 — DIRTY/冲突 → 有界重点火（session 复活后 rebase 解冲突），
Step0.4 已支持外部真相重建（不开重复 PR）。A1 映射表漏了 DIRTY 分支。

---

## 2. 修复目标

### 行为变更（packages/brain/src/harness-relay-watchdog.js）

在 OPEN PR 死局检测中，将 `DIRTY` 识别为需重点火的状态：

**修复前**:
```
isBehind || ciStatus === 'fail' → 重点火
ciStatus === 'pending'         → wait_ci_running（含 DIRTY 误落此处）
else（全绿）                   → 等 merge
```

**修复后**:
```
isBehind || isDirty || ciStatus === 'fail' → 重点火
ciStatus === 'pending'（且非 DIRTY）        → wait_ci_running
else（全绿 + 非 DIRTY + 非 BEHIND）         → 等 merge
```

- `isDirty` 从已有的 `mergeStateStatus` 查询中提取（主路径 L391/fallback L400，不增加额外 gh 调用）
- 日志标记：`reason=resume_conflict`（区别于 `BEHIND`/`CI_FAILURE`）
- attempt cap 沿用现有逻辑，不改数值

---

## 3. 测试计划（先写 failing test，后修代码）

### 新增回归测试

**文件**: `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js`

#### [B1] FAILING → PASSING（核心用例，修复前必须 FAIL）

**场景**: mock `gh pr view` 返回 `state=OPEN, mergeStateStatus=DIRTY`，
容器已消失（`docker ps` 返回空），`gh pr checks --json` 返回空 checks 数组（CI pending 状态）

**断言**:
- 修复前：`out.resumed === 0`（dry wait_ci_running，此断言 FAIL 因期望 resumed=1）
- 修复后：`out.resumed === 1`（spawn 被调）
- 日志含 `resume_conflict`（`console.log` spy 捕获）

**铁律**: 禁止 mock 掉 `mergeStateStatus` 解析路径。`execFn` 必须真实返回含 `mergeStateStatus: 'DIRTY'` 的 JSON，
由 watchdog 内部真实解析路径消化。

#### [B2] 回归保护——BEHIND 路径不变

**场景**: `mergeStateStatus=BEHIND`，CI pending  
**断言**: `out.resumed === 1`，日志含 `BEHIND`

#### [B3] 回归保护——CI 全绿路径不变

**场景**: `mergeStateStatus=CLEAN`，`ciStatus=success`，evaluator gate 已完成  
**断言**: `out.resumed === 0`（等 merge，不重点火）

#### [B4] 回归保护——CI pending 非 DIRTY 路径不变

**场景**: `mergeStateStatus=BLOCKED`（非 DIRTY），`ciStatus=pending`  
**断言**: `out.resumed === 0`（wait_ci_running，不重点火）

### 测试铁律

1. 禁 mock 掉 `mergeStateStatus` 解析路径（不能让 `isBehind`/`isDirty` 推导路径短路）
2. `execFn` 必须返回含真实 `mergeStateStatus` 字段的 JSON 字符串，由 `tryParseJson` 真实解析
3. B1 用例必须在修复前 FAIL（验证测试真正覆盖了 bug 路径）

---

## 4. 交付边界（hotfix 范围）

| 改动 | 文件 | 说明 |
|------|------|------|
| watchdog DIRTY 判定 | `packages/brain/src/harness-relay-watchdog.js` | `isDirty` 提取 + 条件加入重点火分支 + 日志 `resume_conflict` |
| 新回归测试 | `tests/regression/watchdog-dirty-resume/harness-relay-watchdog-dirty-resume.test.js` | 4 条用例（B1 failing→passing + B2/B3/B4 回归） |

**不改**:
- attempt cap 数值
- Step0.4 / rebase 逻辑（已支持）
- 其他 DIRTY 以外的死因路由
- CI 配置（已有 regression 目录自动纳入）

---

## 5. 成功验收

1. B1 用例在修复前 `vitest` 跑 FAIL，修复后 PASS
2. B2/B3/B4 修复前后均 PASS（回归不变）
3. `console.log` 在 DIRTY 场景输出含 `resume_conflict` 字样
4. `out.resumed === 1` 且 `spawnFn` 被调用一次（DIRTY PR + 容器消失）
5. CI 全绿（brain-ci.yml）

---

## 6. 不在范围内

- DIRTY 场景下的 rebase 自动化（Step0.4 人工 rebase 已足够，自动化留 A8 后续刀）
- 其他 mergeStateStatus 值的处置（BLOCKED、DRAFT 等）
- Bark 告警（DIRTY 不是 blocked，不需告警）

---

## Invariant 约束

来源：自愈链 golden path S3（docs/prd/2026-07-15-self-healing-golden-path.prd.md）、合同铁律、历史 PR

1. **attempt cap 不变**：DIRTY 路径必须遵守现有重点火次数上限，不得绕过
2. **BEHIND 路径回归不变**：修复后 BEHIND 仍走 `resume_ci_red reason=BEHIND`，不受影响
3. **测试不 mock 解析路径**：`execFn` 必须返回真实含 `mergeStateStatus` 字段的 JSON，由 watchdog 内部路径真实解析
4. **容器消失是前提**：仅容器消失（无活跃 session）时才走 DIRTY → 重点火；容器存活时仍走现有存活检查

---

## 累积 FR

| FR# | 描述 |
|-----|------|
| FR-1 | `mergeStateStatus=DIRTY` 且容器消失 → 走有界重点火，日志含 `resume_conflict` |
| FR-2 | DIRTY 路径沿用 attempt cap，不新增豁免 |
| FR-3 | BEHIND/CI 红/CI 全绿路径行为不变（回归） |
| FR-4 | 新增回归测试 4 条（B1 failing→passing，B2/B3/B4 回归） |

---

## NFR

- 无额外性能要求（仅增加已有 `mergeStateStatus` 字段的条件判断）
- 不增加额外 gh CLI 调用
- 测试用 vitest，与现有 brain-ci.yml regression 路径一致

---

journey_type: hotfix
target_environment: local_api
