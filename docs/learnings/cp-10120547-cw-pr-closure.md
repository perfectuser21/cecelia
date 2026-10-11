## runner 感知不到被外部关闭的 PR，#6220 关闭两天无人收尾（2026-10-12）

### 根本原因
- runner 拿 PR 只有一个入口 `listOwnPrs`（`gh pr list --state open`），合并门、commander、CI 修复、QA 门、状态恢复/回写全部遍历这份 open 列表。PR 被人关掉（未合并）后不进任何分支：不回写 Brain、不写终态 span、不停预览，任务永远停在 completed + phase=awaiting_qa。
- 「完成」只设计了合并一个出口（merge-gate 写 phase=merged），没有「关闭未合并」出口；Brain 状态机 completed 是终态，也不能事后改 failed，只能在 result 里表达。
- 预览回收只看「已合并且 QA 通过过」，关闭的 PR 永远占着预览容量。
- 修复会话动辄几十分钟，推送前不再确认 PR 状态，中途被关照推照花钱。

### 下次预防
- [ ] 外部对象（PR、预览、分支）每个终态都要有显式出口：设计「完成」时列全 merged / closed / reopened，而不是只写快乐路径
- [ ] 只从「open 列表」驱动的循环天然看不见消失的对象：要么另列终态集合对账，要么按本机/Brain 台账反查外部状态
- [ ] 长会话后的副作用（push、合并、回写）执行前重新确认外部前提仍成立
- [ ] 终态不可逆的状态机（completed）下，用 result 子字段（phase、merge.closed）表达后续事实，并配终态 span 让执行记录说得清原因
