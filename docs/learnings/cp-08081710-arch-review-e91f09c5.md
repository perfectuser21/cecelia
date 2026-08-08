# Learning：review 成功退出不等于 verdict、callback 与任务终态一致

本轮同一 `arch_review` 任务第一轮 exit 0 后，executor 把报告原生的 `CRITICAL` 静默降成 `PASS`；callback 又因为派发未写 `payload.current_run_id` 而被 CAS 拒绝。恢复器随后把仍为 `in_progress` 的任务判死并重新派发。上一轮已合并 PR 的任务也走了同一重跑路径，最终两个重复 review 进程同时存在。

### 根本原因

review 链把三个局部成功误当成全局成功：进程 exit 0、stdout fallback 出 PASS、callback HTTP 返回 200。实际上 verdict 枚举不兼容，lock/run 身份没有写入 task，callback 的 compare-and-set 拒绝也没有被派发器读取，恢复器只能看到未收口的 DB 行并再次点火。

### 下次预防

- [ ] review 原生 verdict 必须有显式映射，未知枚举 fail-closed，禁止 exit 0 默认 PASS。
- [ ] spawn、lock、`payload.current_run_id` 与 executor kind 必须在同一认领合同中建立。
- [ ] callback 返回 `applied=false` 或 CAS rejected 时，派发器必须响亮失败并停止把本次执行记为成功。
- [ ] 回归测试必须覆盖 `CRITICAL` 报告、run-id 匹配/不匹配、PR 已合并但任务未终态以及恢复器不重复派发活执行。
