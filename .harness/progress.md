# Sprint: sprints/07240614-relay-137fea96 (137fea96-c596-4a34-b5ed-af8d2758ea6b)
# 任务: [紧急][postdeploy-verifier] smoke 测试任务清理失败导致误触发 P1（DELETE /api/brain/tasks/:id 路由缺失）
# 开始时间: 2026-07-24
# 备注: 本 worktree 复用自旧任务 264b8c8d，其残留台账已归档为 progress-STALE-264b8c8d.md.bak，不代表本任务进度
planner: done (sprint-prd.md@8b85fa97c, invariants=8, fr=0)
gan: done (contract-draft.md+dod@e7e3a4e, r2, verdict=APPROVED, 铁律覆盖=8/8, judgments_written=2, rubric=.harness/verdicts/gan-e7e3a4e.json)
generator: pr_opened (#4273, red=4fc96dd)
generator: done (pr=#4273, red=4fc96dd, green=14d130d, fix=202820d, CI required checks 全绿)
judge: FAIL (round1, mechFail=theater_mismatch, 误判：contract-draft.md Invariant覆盖行INV-2误用[BEHAVIOR]标签命中"真机"关键词，非真实需求；已开 Notion issue c4993b81；回 GAN round3 做窄范围格式修订)
gan: round3 done (contract-draft.md@efc9e2f77, 纯格式修订：Invariant覆盖8行去[BEHAVIOR]标签+INV-2真机→设备同义替换，reviewer CONFIRMED，之前APPROVED继续有效)
