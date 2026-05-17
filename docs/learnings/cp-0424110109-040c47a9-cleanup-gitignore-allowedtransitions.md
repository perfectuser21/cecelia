# cleanup PR Learning

## 做了什么
1. `.gitignore` 加 `sprint-prd.md` + `.raw-prd-*.md`（手动 /dev worktree 产出物，不应进 git）
2. `git rm --cached sprint-prd.md`（main 上的残留清除）
3. `packages/brain/src/routes/tasks.js:370 allowedTransitions` 补 quarantined / paused 两态出路

## 根本原因
1. **sprint-prd.md 冲突**：手动 /dev plan 文档里的 `cp .raw-prd-... sprint-prd.md` 步骤基于错误假设（备注"branch-protect hook 可能要求"），但 hook 实际不查。三个并发 PR 都改根目录这个文件，连环 rebase 冲突。harness 系统用的是 `sprints/<dir>/sprint-prd.md` 不同路径不受影响
2. **allowedTransitions 死锁**：`routes/tasks.js:370` 字典只列 5 种起始态，quarantined/paused 无条目 → PATCH 回退 `allowed:[]` → 今晚 T4/T3 的 PR 已合入 main 但状态无法回写 completed

## 下次预防
- [ ] 手动 /dev 工件（PRD/plan/learning）应直接 gitignore 或提交到 docs/ 专门目录，不堆根目录
- [ ] 新加 task status（quarantine.js / escalation.js 里的 `paused/quarantined`）必须同步更新 `allowedTransitions` 字典
- [ ] 写 skill 或 plan 文档里的"约定"步骤要 grep 验证真的被消费，别传"备注 hook 可能要求"之类未证实声明

## 关键决策
**一次性彻底修**（Alex 要求），不走 SQL 兜底：
- PR 合入 + Brain redeploy → 新 allowedTransitions 生效 → API PATCH 直接释放 T4/T3
- 长期：后续再碰 quarantined/paused task 都有 API 可释放，不再需要 SQL

**保留 quarantine release API 不变**：它的语义是"解除隔离回 queued"（重新被 tick 派发），和 "人工强制 completed" 是两种路径。不混到一起。
