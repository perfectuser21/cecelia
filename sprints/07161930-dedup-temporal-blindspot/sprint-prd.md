# Sprint PRD: 修撞车检查时间盲区

**Sprint**: 07161930-dedup-temporal-blindspot  
**Task ID**: 1ee28cc5-d502-49ac-b183-fac33cb945ed  
**Date**: 2026-07-16  
**Type**: bugfix

---

## 背景

07-16 实证（zenithjoy #1335 vs 无头 session 重复修复）：`/dev` 撞车检查只用 `gh pr list --state open`，任务排队 50min 期间修复已合并 → 无头 session 重做一遍 + 接死代码 + 软断言混过 CI。

**两处根本漏洞**：
1. 撞车检查只防空间撞车（当前 open PR），不防时间撞车（近期已 merged PR）
2. bug fix session 未执行『复现或退场』铁律（failing test 若不红说明 bug 已修，任务应标 obsolete）

**现状代码位置**：`packages/engine/skills/dev/scripts/worktree-manage.sh:342`
```bash
# 当前：只查 open，时间盲区
pr_num=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
```

---

## Invariant 约束

| ID | 约束 | 来源 |
|----|------|------|
| INV-01 | engine 改动 PR title 必须以 `[CONFIG]` 开头（bash-guard.sh 强制） | `packages/engine/hooks/bash-guard.sh:191` |
| INV-06 | 版本 bump 必须 5 文件同步：`package.json`、`CHANGELOG.md`、`feature-registry.yml`、`SKILL.md frontmatter`、`VERSION` | `packages/engine/skills/dev/steps/light-evaluator.md:99` |
| INV-T1 | 撞车检查命中 merged PR → 必须输出警告并 exit 非零，禁止静默放行 | 本 Sprint 新增 |
| INV-T2 | bug fix 路径中，failing test 在最新 main 不红 → 禁止继续开发，任务标 obsolete 并留痕 | 本 Sprint 新增 |
| INV-T3 | 纯新功能任务（非 bug fix）不受 INV-T2 约束（回归保护） | 本 Sprint 新增 |
| INV-T4 | 合同测试（FR3）必须先写 Red commit，再写修复 Green commit，顺序不可逆 | TDD iron law，`SKILL.md:267` |

---

## 累积 FR

### FR1: 撞车检查时间维度升级

**位置**: `packages/engine/skills/dev/scripts/worktree-manage.sh`（`cmd_list` 函数及任务派发前置检查）

**改动逻辑**:
- 原查询：`gh pr list --state open`（只查空间维度）
- 新查询：同时查 open + 近 7 天 merged（`--search "is:pr is:merged merged:>DATE"`，含任务短号/关键词匹配）
- merged 命中条件：PR title 或 body 含任务 short_id 或关键词
- 命中 merged PR → 输出警告：`[COLLISION] 疑似已被 PR#N 完成，请核对后关闭任务，不许静默继续`
- 警告后 exit 1，阻断无头 session 继续执行

**验收**:
- `[BEHAVIOR] Test: bash packages/engine/tests/dedup-temporal-check.sh` → exit 0

---

### FR2: 复现或退场铁律（bug fix 路径）

**位置**: `packages/engine/skills/dev/SKILL.md`（路径 A Bug 段）

**改动内容**: 在 systematic-debugging 衔接段前插入铁律说明：
```
复现或退场铁律（bug fix 专属）：
1. 写 failing test，在最新 main checkout 上运行
2. 若测试不红（bug 已不存在）→ 立即停止，任务标 obsolete/completed(duplicate)，
   留痕引用已存在的修复 PR，禁止继续开发
3. 测试确认红 → 继续修复流程
4. 纯新功能任务不受本铁律约束
```

**验收**:
- SKILL.md 路径 A 段含「复现或退场」字样及上述 4 条规则
- 纯新功能任务不受影响（回归保护条款明确写入）

---

### FR3: 合同测试——mock gh 返回 merged 命中场景

**位置**: `packages/engine/tests/dedup-temporal-check.sh`（新建）

**测试场景**:
- 场景 A（Red → 现版本行为）：mock `gh pr list` 返回 open 无命中但近 7 天 merged 有命中 → 期望：现版本放行（exit 0），证明 bug 存在
- 场景 B（Green → 修复后行为）：同样 mock → 期望：修复后输出警告并 exit 1（阻断）

**commit 顺序**:
1. commit-1: 写 failing test（场景 A 验证现版本放行）
2. commit-2: 修复 `worktree-manage.sh` + 场景 B 变绿

---

### FR4: engine 改动三要素

修复 PR 必须包含：
1. PR title 以 `[CONFIG]` 开头（bash-guard.sh INV-01）
2. 版本 bump 5 文件同步（`19.5.0` → `19.6.0`，INV-06）
3. `feature-registry.yml` 新增 `dedup-temporal-check` 条目 + `CHANGELOG.md` 记录本次改动

---

## NFR

| ID | 要求 |
|----|------|
| NFR-01 | merged 查询不得阻塞主流程超过 5s（超时 fallback 到仅查 open，不抛错） |
| NFR-02 | 警告信息必须含 PR 编号和 merged 时间，便于人工核对 |
| NFR-03 | 合同测试（FR3）永久留 CI（regression-contract.yaml 注册），不可删除 |
| NFR-04 | 『复现或退场』铁律不影响非 bug fix 路径（路径 B 小改动 / 路径 C 大功能） |

---

## DoD（Definition of Done）

- [ ] `[BEHAVIOR] Test: bash packages/engine/tests/dedup-temporal-check.sh` — exit 0
- [ ] `[ARTIFACT] SKILL.md 路径 A 段含「复现或退场」铁律 4 条`
- [ ] `[ARTIFACT] worktree-manage.sh 撞车检查同时查 open + 近 7 天 merged`
- [ ] `[ARTIFACT] 版本从 19.5.0 bump 到 19.6.0（5 文件同步）`
- [ ] CI 全绿

---

## 实现顺序

1. 写 `packages/engine/tests/dedup-temporal-check.sh`（mock gh，场景 A 红）→ commit-1
2. 修 `packages/engine/skills/dev/scripts/worktree-manage.sh`（查询升级）→ 场景 B 绿 → commit-2
3. 改 `packages/engine/skills/dev/SKILL.md`（插入复现或退场铁律）→ commit-3
4. 版本 bump 5 文件 + `feature-registry.yml` 注册 + `CHANGELOG.md` → commit-4
5. PR title: `[CONFIG] fix(engine): 撞车检查升级 open+7d merged + 复现或退场铁律`

---

journey_type: bugfix  
target_environment: local_api
