# 通用 Commander 闭环实施合同

用户授权：2026-10-13「开始吧」，已讨论确认通用 Commander、先恢复已验证实现、独立验收、五个视角。主任务 b1b9d813-cf34-46ac-a294-5d1f5df50a88；项目 c52eeef8-7c00-4091-8621-c316012aae4b。

## 目标与边界

Brain 唤醒 OpenClaw 的 work-commander；加载 workflow-commander 和本次冻结 workflow 合同。节点失败不立即结束目标，不自动现场改代码；先核查现场、重入已有执行或使用兼容且已验证的实现。成功必须有独立核验和收尾事实。不能保证外部系统永远可用；未知或超预算保留同任务的阻塞原因和恢复条件。

只复用树、仓库、任务账、运行账、版本记录。任务事实在 tasks，运行事实在 task_runs/task_events/spans，冻结定义和发布绑定用现有 definition_versions/releases/run_definition_bindings。不得新增平行账本、escort 角色或旧 initiative_runs 业务通路。模型按用户要求使用 Codex。

## 正式路径

1. 登记 workflow、活动合同与实现引用。一次请求提供 workflow_key、workflow_input 与 workflow_definition（沿用现有 startRun definition 字段）。
2. commander-v2 协议预检解析冻结定义、输入 schema、资源和已部署实现；ready 与部署摘要吻合后方可领资源。非手机流程不得要求或伪造 serial/profile/biz。
3. 在任何 SSH 或业务副作用前，事务完成 startRun({definition})。固定本次输入/摘要、task_id/run_id、attempt、owner_epoch、总 deadline、cleanup 预算和最大 attempts；缺重试政策默认一次，重入不得延长预算。
4. Brain 经 stdin 下发结构化 JSON 信封，Commander 传递相同输入至运行目录文件。不得把自由文本插入 shell；凭据仅传引用。执行输出、产物引用和证据完整回写运行账。
5. 活动反馈经内部鉴权接口按 task/run/attempt/owner_epoch/seq/hash 事务校验。相同序号相同内容幂等，异内容冲突；旧 owner/旧 run/晚到反馈不得推进新状态。活动事实使用现有 spans。
6. 掉线先读官方子会话绑定和 agent.wait，仍活只续接等待。已完成丢回执则幂等补账。确认旧执行结束且合同允许恢复才新建 attempt/run，保持 task_id。切换旧版本需兼容/验证/部署证据，不能重写旧 run。
7. 执行结束记录真实 attempt 终态，原任务以 workflow_control.phase=awaiting_verify 留在受管理状态。确认执行停止才关闭执行租约；核验子任务有独立租约和固定 run/definition/input/产物引用。
8. 通用控制器幂等创建核验子任务。核验仍是独立 research 任务，以限定标记复用现有 OpenClaw 执行与收割通道，使用单独 session 和实际 Codex 模型回执；普通 research 的路由不变。独立核验只看合同和产物，PASS 且 cleanup 证据成立才能完成原任务；fail/inconclusive 返回断言与证据供恢复。未知副作用先读回，不重复发布。
9. 旧 reaper、通用完成入口和 lease/watchdog 不得越过 v2 控制器。factory 对 v2 只消费最终判定且去重，不再重复创建核验；普通 workflow 不写 factory ledger。

## 上线与验收

部分上线或回滚时新协议未 ready 禁止起跑；旧在途运行按原合同收尾。新 workflow 登记使用现有 authoring/定义/发布接口，源固定 commit，实际部署独立读回。恢复预算和账号授权不因重试扩大。

必须验证：正常输入输出；中文/换行/空数组及恶意 shell 字符往返；绑定失败零副作用；重复派发只有一个活执行；child 仍活重入；终态丢回执补账；核验失败回原任务；未知活性不重复动作；旧 owner 反馈拒绝；跨重启 deadline 不变；部署漂移拒绝；无稳定版不伪造回退。

真实验收两类：已有授权的抖音私密发布（允许关闭并放弃旧编辑）与不依赖手机的任务/部署核对报告。报告由独立核验重读原始来源与 JSON/CSV 产物。两类均从正式 Brain→OpenClaw→Commander 入口运行，查回任务、运行、输入输出、活动、版本及证据关系；单测通过不能代替真实验收。

执行位置以冻结 execution_location 为准。启动 OpenClaw CLI 的机器不等于 Codex shell 的机器；Commander 的信封、外壳命令和产物读回须通过已验证的宿主工具通道到达该位置，不能把远端绝对路径当成本机路径。核验会话不得调用业务子会话或修改待验产物。

## 评审

/dev Proposer/Challenger 第二轮收敛 new_issues=[]。采纳七项：留账先于起跑、协议隔离、持久预算、核验租约、反馈 fencing、完整非手机链路、通用核验消除工厂互等。实现过程不得把上述限制弱化为提示词约定。

## 两端冻结接口（实现时共同遵循）

- 协议值：`commander-v2`；原任务 `payload.commander_protocol` 选择新路径。无效/未知协议拒绝；不能降级旧路径。
- 信封：`{protocol,task_id,run_id,workflow_key,attempt,owner_epoch,deadline_at,cleanup_deadline_at,input,input_sha256,definition,contract,recovery}`。`definition` 沿用现有运行绑定字段；contract 是冻结 workflow 文档，不能从最新版替换。由 Brain 产生的 run/epoch/预算不可由执行端扩大。
- 运行端 `wf-launch.sh --ready` 无副作用输出 JSON；`wf-launch.sh --envelope <绝对JSON路径> --parent-session <当前官方父session>` 启动或重入。自由业务输入只存在 JSON 内。`wf-status.sh <run_id>` 读回真实状态。
- 内部反馈入口：`POST /api/brain/workflow-commander/tasks/:task_id/events`；事件 `{protocol,run_id,attempt,owner_epoch,seq,type,data}`，服务器计算内容摘要并绑定冻结定义。事件类别统一 `started/heartbeat/activity_started/activity_completed/delivery/blocked`。`data` 上限 200000 字节，输入及信封均有明确有界校验。权限沿用 internalAuthOrLoopback，不借无认证 heartbeat。
- delivery 保留 `protocol/task_id/run_id/attempt/owner_epoch/input/input_sha256/definition/outputs/evidence/cleanup/effects/status/failure`。cleanup 为 `{completed:boolean,evidence:[]}`；effects 每项 `{key,status,receipt}`，幂等 key 基于任务目标与活动，不用 run_id 作为唯一外部幂等键。
- 独立核验回写 `result.workflow_verification={task_id,run_id,attempt,definition_sha256,verdict,assertions,evidence}`，verdict 仅 PASS/FAIL/INCONCLUSIVE；与父任务身份完全匹配。独立核验不得接受执行者自述作证据。任务完成入口以持久通用控制状态作门禁。
- 登记后须实际生成 definition_versions 才能创建 release；使用既有 `/implementation-ci/refresh`/backbone 的 snapshotDefinitions。五维读回使用 `/runs/:run_id/reconciliation` 和 `/definition`，不为旧 `/runs` 查询制造另一行运行账。
