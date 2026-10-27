## 换思路

采纳按验收阶段归位的方向：当前产品 QA 只操作预览环境可到达的入口；发布前 Native 隔离、测试辅助内部对抗与过去现场由当时 verify 的原生命令、完整输出、退出码和独立外层核验负责。评审文件没有单列“换思路”小节，本轮依据 R-3 和任务给定的阶段边界修正 Q-6；不增生产 runner 的测试入口。任何阶段缺证仍不得判通过。

### R-2
处理: 采纳
说明: S-1、S-2 和 Q-2 明确用现有引用 `path` 传递完整 `https://` URL；new-task 保留该声明，intent 在 Git 路径及登记校验前返回独立的 `unsupported/external_authority_unsupported`，required 引用阻断后继且不联网。QA 按 Q-2 用真实计划建单并运行 intent，可看到区别于普通非法路径的缺口。代码核对：当前 `new-task.mjs` 的 `body()` 仅构造 `payload.acceptance` 等字段，`activities/intent.mjs` 从 GET 任务取资料；现无来源字段，因此无需为未支持来源扩充产品接口。

### R-3
处理: 采纳
说明: Q-6 改为当前 QA 可启动的受控 runner 超时/终止路径：记录本场景 detached 子进程 PID，核实进程消失及失败回执。伪造登记、重复 PID、nonce 身份挑战、Native owned 枚举与 194 项回归仍保留在 S-5，由发布前 verify 实跑并留完整原生证据，独立外层核验；缺证不得通过。代码核对：`runner/run-once.mjs` 的入口读取 runner 配置与任务服务，`runner/__tests__/helpers/sandbox.mjs` 通过 `runnerEnv()` 和 `runOnceProcess()` 启动测试子进程，没有接收测试登记的产品入口。
