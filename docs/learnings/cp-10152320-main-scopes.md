## main 与 PR 来源接线一致（2026-10-15）

### 根本原因

完整双来源快照已发布，但旧 main 入口仍只验证 KR；相同源码树在 PR 联合归属通过后，main 又把 Factory 文件误判为无人认领。来源发布成功不能替代真实消费端验收。

### 下次预防

- [x] mainscopewire 从真实事件环境到实际 CLI 检查完整来源选择；官方 main 明确使用固定双 scope，其他仓库和模式不得隐式扩展。
- [x] mainpurposeproof main 用途从联合证据生成时即参与摘要与复验，逐 scope 执行真实回归，保留 not_evaluated 业务运行边界，不重贴 PR 标签冒充主线成功。
- [x] mainfixedbundle 用正式固定 base/head bundle 验收真实 main 路径，核中央版本 ID 保留且没有 PR candidate；原主模板与旧消费者来源合同逐字保持。

## 预览停止必须确认实际回执（2026-10-15）

### 根本原因

停止接口的 HTTP 200 也可能携带 stopped=false/cleanup_failed。只看 HTTP 成功会把清理失败写成已停止，并提前清除持久待办。

### 下次预防

- [x] previewstopreceipt 终态清理以 HTTP 成功且 stopped 严格等于 true 为确认条件；失败、缺失或损坏回执保留持久待办，用真实 runner 子进程覆盖下一轮及历史窗口外恢复，确认后才同步状态，不补写历史或重复合并与 Learning。
