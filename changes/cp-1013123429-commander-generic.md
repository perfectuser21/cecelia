## Brain {VERSION} — 通用 Commander 固定合同与独立核验闭环

- 正式 workflow_dispatch 接 commander-v2；冻结输入、合同、版本和总预算后才派发，非手机流程不领手机锁。
- 内部活动反馈按运行、attempt、owner_epoch、序号与服务端摘要事务去重，活动沿用 spans，运行沿用 task_runs 及定义绑定。
- 真实停止后创建独立核验任务，PASS 与收尾证据成立才完成原目标；安全失败在同 task 重试已验证实现，未知副作用保留读回条件。
- 旧 reaper、租约、回调、任务完成和活性巡检不能抢收 v2；factory 只消费最终判定。同类失败按实现版本积累，只形成改进建议，不现场改代码。

- 显式 definition-freeze-v1 登记核对固定 Git 合同和实现字节，生成既有 definition_versions；authoring scope 复用地图、回归与发布门禁，不自动批准新版本。

- 完成门禁同时验证冻结输出 schema 与实际路径 span；不合格成功声明保留原始事件并派生失败，进入同一独立核验与恢复链。
- 恢复信封携有界失败断言和证据，核验使用真实 Codex 路由及官方回调，固定执行机用于跨机只读产物读回；blocked 巡检公平轮转。
- 信封活动及步骤 key 精确关联冻结 release 的引用和 UUID，当前定义漂移不影响；路径缺口在 ready、运行与资源副作用之前拒绝。
- 输入输出 schema 校验首错即停，避免全错误遍历资源耗尽；shell 活动依据冻结 by 字段记 code，模型为空，不信任事件自述。
- 独立 research 核验使用限定 OpenClaw transport，固定 skill-factory / openai/gpt-6.1-sol；独立运行与租约先提交再起跑，池满/旧 Bridge 不阻断，普通 research/qiumi 不变。
- 核验回执逐项核对官方 requested/effective、rerouted 及执行 trace，缺证据或错误模型不能完成；原始产物优先经 gateway_exec 只读核验执行机，不能误把模型沙箱当 MMV。
- 同release多scope发布证据逐份保持完整冻结计划与断言核验，按实际Workflow所属依赖闭包联合覆盖全部定义；缺失或损坏证据仍拒绝发布绿。
