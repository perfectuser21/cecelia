## Brain {VERSION} — 通用 Commander 固定合同与独立核验闭环

- 正式 workflow_dispatch 接 commander-v2；冻结输入、合同、版本和总预算后才派发，非手机流程不领手机锁。
- 内部活动反馈按运行、attempt、owner_epoch、序号与服务端摘要事务去重，活动沿用 spans，运行沿用 task_runs 及定义绑定。
- 真实停止后创建独立核验任务，PASS 与收尾证据成立才完成原目标；安全失败在同 task 重试已验证实现，未知副作用保留读回条件。
- 旧 reaper、租约、回调、任务完成和活性巡检不能抢收 v2；factory 只消费最终判定。同类失败按实现版本积累，只形成改进建议，不现场改代码。

- 显式 definition-freeze-v1 登记核对固定 Git 合同和实现字节，生成既有 definition_versions；authoring scope 复用地图、回归与发布门禁，不自动批准新版本。
