## Brain {VERSION} — coding harness 首跑修复：QA 门等必需检查全部登记、改 Brain 源码自动带版本碎片

- 首条全链任务 4ac5fa39（PR #6139）暴露：`gh pr checks --required` 只列已登记的检查，ci-passed 还没开跑时只剩 Harness 门是绿的，QA 门（与 CI 修复）误判「必需检查全绿」提前开验。requiredState 现按 main 的分支保护 + 规则集取规定的必需检查名，未全部登记即 pending；查不到规定名单也按 pending。
- publish 活动：PR 改了 packages/brain/src 且分支上没有 changes/ 碎片时，自动写 changes/<分支>.md（`## Brain {VERSION} — <需求标题>`），与 sprint 记录同一提交——此前链路产出的源码 PR 必被 brain-version-bump-gate 判红。
- brain-version-bump-gate 报错提示改为写 changes/ 碎片（原提示「npm version patch」与「PR 不碰版本五件套」新规矛盾，会把 CI 修复会话引去改 package.json）。
