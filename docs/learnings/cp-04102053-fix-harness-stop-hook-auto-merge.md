# Learning — harness stop hook 缺少 auto-merge

**分支**: cp-04102053-fix-harness-stop-hook-auto-merge
**日期**: 2026-04-10

---

### 根本原因

`devloop-check.sh` 条件 0.5（harness 快速通道）在检测到「step_2_code done + PR 已创建」后直接 `return 0` 退出，没有执行 `gh pr merge --squash --auto`。Generator 在 harness 模式下不走 Stage 4 Ship，因此 auto-merge 永远没机会被开启，所有 Generator PR 需要手动合并。

---

### 修复方法

在 `return 0` 之前插入一行：
```bash
gh pr merge "$_h_pr" --squash --auto 2>/dev/null || true
```

`|| true` 保证即使 auto-merge 开启失败（如已开启/权限问题）也不阻断 done 流程。

---

### 下次预防

- [ ] harness 模式任何新的「完成退出」分支，都需要检查是否已包含 auto-merge 调用
- [ ] stop hook 新增 harness 相关条件时，review checklist 加入「auto-merge 已开启？」
