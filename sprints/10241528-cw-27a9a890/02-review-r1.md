---
task_id: 27a9a890-fccc-4874-9655-420030b8587b
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 5
场景覆盖: 7
回归风险: 8
可执行: 6

### R-1
针对: S-4, S-5, Q-5, Q-6, I-4
严重度: 阻断
场景: QA 在 PR 预览工作区照 Q-5 验收已发布的 HEAD，发现 publish 控制器已将本任务报告的合法来源行提交到 `.implementation-source-relations.json`，于是按 Q-5 的“相对基线零差异”把合规交付误判为失败。
依据: `01-intent.md` 的 I-4 明确将 manifest 零差异限定为发布前 verify，且发布后允许可信控制器来源增量；规格 S-5 也要求发布后不重用零差异判据。Q-5 却以 PR 预览 QA 工作区为前提，并要求对固定基线 manifest 零差异；`packages/brain/scripts/coding-workflow/runner/lib/qa-gate.mjs` 的 `qaRound` 在 PR 工作区启动预览 QA，此时 publish 阶段已完成。
说明: 把 Q-5 的零差异检查明确归于发布前 verify 的当时现场及回执；预览 QA 只按 Q-6 核验发布后合法来源增量和同步归属，不重新要求当前 HEAD 的 manifest 零差异。两阶段各保留固定基线、完整范围及原 README 验收。
