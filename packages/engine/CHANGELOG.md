# Changelog

All notable changes to this project will be documented in this file.

## [14.2.1] - 2026-04-03

### Fixed
- P0+P1 深度修复 — check-version-sync exit 0 门禁失效 + devloop-check date 误触发90分钟告警 + execution-logger %→%% 日志污染 + fire-learnings awk 只读最后节

## [14.2.0] - 2026-04-03

### Fixed
- 深度 bug 修复 — devloop-check PROJECT_ROOT 未定义 + hook-utils 占位符误判 + worktree-manage cleanup 命令失效

## [14.1.1] - 2026-04-03

### Fixed
- 深度审计修复 — stop-dev.sh curl 超时 + devloop-check 容错 + bash-guard 安全加固 + branch-protect 精简 (#1816)
- Harness v2.0 端到端修复 — preparePrompt sprint 路由 + devloop 容错 (#1817)

## [14.1.0] - 2026-04-03

### Added
- /dev 适配 Harness v2.0 模式 — Generator/Evaluator 双 Agent 架构，sprint-contract 驱动 (#1814)

## [14.0.0] - 2026-04-02

### Changed
- **BREAKING**: CI 重设计 — 4层32job → 1层6job，精简 90%+ CI 代码 (-12,299行) (#1802)
- Hook 精简 — 删除 verify-step 状态机，CI brain-unit 硬卡 (-1,365行) (#1804)

## [13.78.14] - 2026-04-02

### Changed
- 大规模清理 sprint（v13.78.x）— 5路 agent 审计，删除 42+ 孤儿文件、136+ 临时文件、26个腐烂 regression 条目、11个废弃 devgate，共减少 30,000+ 行 (#1793-#1801)
- skills/dev/ 同步到 v5.0.0：4-Stage Pipeline 架构 (#1797)
- branch-protect.sh 精简 v28 — 998行→206行，PRD/DoD 检查移交 CI (#1786)
- 补 E2E 测试 — devloop-check 全 7 条件覆盖 (#1787)

## [13.77.2] - 2026-04-02

### Fixed
- stop-dev.sh + devloop-check.sh 精简 — 删除 seal 防伪机制（v16.0.0），减少状态混乱 (#1784)

## [13.3.0] - 2026-03-19

### Changed
- Dev 线 Phase 2：审查任务改本机 Codex 执行 + PR 创建移到审查 PASS 后 + /simplify 集成 + 清理死 skill（audit/qa/assurance）

## [13.2.0] - 2026-03-19

### Added
- 新增 code-quality + prd-audit Codex 门禁 — devloop-check.sh 条件2.6/2.7（CI之前）
- Brain task_type 注册，4维度代码质量审查 + PRD覆盖三态审计

## [13.1.1] - 2026-03-18

### Fixed
- cto-review SKILL.md Step 1.4 改用 git diff origin/main...HEAD（push前无PR时可用）
- devloop-check.sh 条件1.5 intent_expand completed 后写入 .enriched-prd-branch.md 本地文件（幂等）
- 01-taskcard.md 指示 AI 读取 enriched PRD

## [13.1.0] - 2026-03-18

### Added
- 新增 intent-expand skill — 意图扩展，沿 Task→Project→KR→OKR→Vision 层级链查询并生成 enriched PRD

## [13.0.0] - 2026-03-18

### Added
- 新增 packages/engine/skills/cto-review/SKILL.md — CTO 代码审查 Skill 定义
  - 五个审查维度：需求符合度/架构合理性/代码质量/DoD符合度/安全性
  - PASS/WARN/FAIL 决定规则、Brain execution-callback 回调格式
  - devloop-check.sh 条件2.5联动机制

## [12.93.0] - 2026-03-16

### Changed
- ci-l3-code.yml: `coverage-delta` job 替换 `anuraag016/Jest-Coverage-Diff` 为 `davelosert/vitest-coverage-report-action@v2`
  - 兼容 Brain vitest 输出的 json-summary 格式（非 jest 格式）
  - 读取 `packages/brain/coverage/coverage-summary.json` + `coverage-final.json`
  - `needs` 新增 `changes`，添加 `needs.changes.outputs.brain == 'true'` 条件（避免无 Brain 变动时也跑）
  - 迁移命令：run migrations 改用 psql 逐文件执行
- ci-l3-code.yml: 新增 `coverage-baseline` job，在 push 到 main 时运行，为 PR 对比提供基线数据

## [12.90.0] - 2026-03-16

### Added
- ci-l1-process.yml: `changes` job 接入 `affected-packages.js`，输出 brain/engine/quality/workflows/frontend 五个 outputs
  - `quality-meta-tests` job 加 `if` 条件，仅在 quality 或 engine 改动时运行

<!-- 历史版本记录已截断，完整历史见 git log -->
