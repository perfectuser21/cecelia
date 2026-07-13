# relay-watchdog 三盲区:中途死的 headed session 无人重点火/收尸

task 5b5a3ef1 · issue 73424ab0 · brain 1.258.5

## 现象

claude-headed-smoke 死于 GAN proposer 阶段后,run 卡 `phase=gan` 逾期 18 小时无人救,占死 harness 并发槽(上限 2),导致 headless-smoke 饿死队列一整天。

## 根本原因

`harness-relay-watchdog.js` 两处判据把 headed relay session 的两道救援网同时架空:

1. **存活检测判据从旧图 copy-paste**:`_handleHeadedRun` 只在 `run.phase === 'A_planning'` 时做 ssh tmux has-session 存活检测。`A_planning` 是旧 LangGraph 图的 phase 命名,relay 真实 phase 是 `planning/gan/generate`——判据**永不命中=死代码**,headed session 死在 gan/generate 阶段直接落 else 返回 `needsRefire:false`,无人重点火。

2. **收尸 SQL 写死单一 host**:`scanStuckHarness` 逾期收尸 `WHERE orchestrator_host = 'skill-relay-codex'`。T6(88e0b448)把 headed 从 codex-only 泛化到 codex|claude 时,新增了 `skill-relay-claude-headed`/`skill-relay-session` 等 host,但收尸 SQL 的 host 过滤没同步扩宽 → 非 codex host 逾期永不被收尸标 failed。

**为什么逃过测试**:既有 `headed-watchdog.test.js` 用 `phase: 'A_planning'` 喂测试(命中判据所以绿),和生产真实 phase(`gan`)脱节——测试验证的是代码内部假设值,不是生产真实值。

## 修复

- 盲区1:判据 `phase === 'A_planning'` → `phase !== 'done' && phase !== 'failed'`(非终态即检测)
- 盲区2:host 过滤 `= 'skill-relay-codex'` → `LIKE 'skill-relay%'`(覆盖全部 host)

## 下次预防

- [ ] phase/host 这类枚举判据禁写死单值:用非终态集合 / `LIKE 'skill-relay%'` 前缀匹配,新增 phase/host 时自动覆盖
- [ ] watchdog 测试必须用**生产真实值**(relay phase=gan/generate)喂,而非代码内部假设值(A_planning);这是让"测试与生产脱节"类 bug 无处藏的守卫
- [ ] 做能力泛化(codex→claude/session 之类)时,全文 grep 同类硬编码判据(`skill-relay-codex`、`=== 'X_phase'`),逐处确认是否需要同步扩宽
