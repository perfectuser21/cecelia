# Learning: 对抗网络两个缺陷修复 — 无限收敛 + 独立 Evaluator

**分支**: cp-03310921-evaluator-reconnect
**日期**: 2026-03-31

---

### 根本原因

**缺陷 1：MAX_ROUNDS=3 是用超时代替收敛**

对抗网络的本质是持续辩论直到真正对齐，而不是"辩不完就算了"。固定轮数上限意味着3轮后强制失败，这跟用超时停止一场还没结束的辩论是一样的逻辑错误。正确的停止条件是：双方无法再改变对方（死循环），而不是轮数到了。

**缺陷 2：Generator 自验自过**

02-code.md 的自验证（2.3.3）是 Generator 自己跑自己写的 Test 命令，"左手打右手"。playwright-evaluator.sh 脚本存在且功能完整（从 Task Card 读 [BEHAVIOR] Test、逐条执行、写 seal 文件），但在 v1.4.0 时从 Stage 3 移除并标注"改为 post-merge 触发"，post-merge 触发从未实现，导致独立验证这一步从 pipeline 中消失。

---

### 下次预防

- [ ] 凡是"有上限的重试/轮数"设计，问自己：上限到了是收敛了还是放弃了？如果是放弃，改成死循环检测
- [ ] 删除某个步骤时，必须在同一个 PR 里实现替代方案，不能留"TODO: 以后实现"
- [ ] 脚本文件存在但从未被调用 = 死代码，月度巡检时应检查 scripts/devgate/ 下的脚本是否都被引用

---

### 修复方案总结

**无限收敛（01-spec.md v3.4.0）**：
- 移除 `MAX_ROUNDS = 3` 和 `if round >= MAX_ROUNDS`
- 引入 `prev_divergence` 记录上轮分歧
- 死循环检测：`divergence_lists_identical(divergence, prev_divergence)` → 注册 P1 + FAIL

**独立 Evaluator（02-code.md v6.3.0）**：
- 新增 2.3.4 步骤（原 2.3.4+ 顺延为 2.3.5+）
- 调用 `playwright-evaluator.sh <TASK_CARD> <BRANCH>`
- FAIL → exit 1 → bash-guard 阻止标记完成 → Generator 必须修复代码重跑
