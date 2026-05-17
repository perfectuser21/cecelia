# Learning: 数据闭环 v1 — 三个交付物补缺

**Branch**: cp-04080722-b5d45c39-b6f5-4924-9b20-ac8271
**Date**: 2026-04-08
**Task**: [SelfDrive] 数据闭环 - 第一周交付：全平台采集接入验证

---

### 根本原因

任务第3次重试仍失败，核心原因是前2次尝试时 worktree 创建失败（branch 已存在 + main 分支有未提交改动冲突），导致进程直接退出。本次在已存在的 worktree 中继续执行。

任务描述的三个交付物均未以独立文件形式存在：
1. `docs/templates/weekly-report-template.md` — 周报 Markdown 模板从未创建（`weekly-report-generator.js` 生成的是字符串，无静态模板文件）
2. `packages/brain/src/scripts/topic-score-demo.js` — 选题评分逻辑分散在 `topic-heat-scorer.js`，无可独立运行的 Demo
3. `packages/brain/src/scripts/scraper-check.js` — 无统一的采集通路可用性验证入口

### 下次预防

- [ ] Demo 数据量级要与归一化基准（MAX_RAW_SCORE）匹配，否则全部输出100分。验收前先 `node script.js` 肉眼确认输出有差异
- [ ] `scraper-check.js` 中顶层 `import pg` 在 dry-run 时也会触发 node_modules 查找 → 改成 `await import('pg')` 放入非 dry-run 分支
- [ ] worktree 中运行测试必须用主仓库 vitest：`node --experimental-vm-modules /main/node_modules/.bin/vitest run <test>`
- [ ] Brain 任务"进度0%"不等于"什么都没做"——先用代码搜索评估真实缺口（grep + find），再决定从头写还是补缺
