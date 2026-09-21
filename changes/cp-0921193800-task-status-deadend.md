## Brain {VERSION} — 任务状态机的隐式死胡同：漏枚举的状态伪装成终态

- `PATCH /tasks/:id` 的转移表原先内联在 `routes/tasks.js`，只枚举 8 个状态；生产实际
  用到 15 个。没枚举到的取 `undefined`，被判否后以 `allowed: []` 返回——**与"设计上的
  终态"完全同形**。2026-09-21 实测在押 2483 条：blocked 287 / cancelled（双 L）1485 /
  archived 673 / completed_no_pr 38 / quota_exhausted，活干完了也写不回账本
  （issue a4991491，当天第五次发作）。
- 表抽到 `lib/task-status-transitions.js`：15 个状态逐个显式写出（终态也写成 `[]`，
  不靠"查不到"默认），等待态（blocked / quota_exhausted / paused / quarantined /
  两种拼写的 cancel / dep_failed / pending_postdeploy）一律给出路且能直接回 `completed`。
- `resolveAllowedTransitions` 区分「这是终态」(`known:true`) 与「我不认识这个状态」
  (`known:false`)，后者返回新错误码 `UNKNOWN_TASK_STATUS` —— 漏枚举是缺陷，不许再伪装成策略。
- 机械守卫 `task-status-transitions.test.js`：正则扫 brain src 里所有
  `UPDATE tasks ... SET status = 'X'` 的字面量，任何一个不在 `TASK_STATUSES` 里就报红
  （带 >3 条下限，防正则失效导致空集假绿）；等待态无出边、或无法回 `completed` 同样报红。
- 附带查明：287 条 blocked 全部 `blocked_until IS NULL`，而自愈回路条件是
  `blocked_until <= NOW()` —— 这条路径从未、也不可能命中过任何一条。`blockTask` 文档说
  `until: null = 手工解除`，而"手工"那条路正是被本缺陷堵死的。本 PR 恢复手工路径；
  各调用方是否该自带退避另议。
