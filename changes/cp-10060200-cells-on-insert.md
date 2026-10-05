## Brain {VERSION} — 树+仓库 v3.0 第 4 刀收尾：收敛对账时补齐 Activity 的 8 个验收格

- 合同同步新建的 Activity 没有验收格，收敛对账翻 `readback` 格颜色的那条 UPDATE 会命中 0 行，颜色静默丢掉。`reconcileActivity` 现在翻色前先调用 `ensureEightCells` 把固定 8 格补齐（缺的补灰格，已有的不动，幂等）。
- `ensureEightCells` 与 8 个标准格键抽到 `lib/activity-cells.js`，沉淀技能登记候选与收敛对账共用。
- 刻意没做：合同同步插入 Activity 时同步补格。试过：补格后会进入实现影响快照（快照把全部格子当断言读取），改变既有口径、让试点发布验证的夹具全红，那条口径问题另议，不在这里捆绑。
