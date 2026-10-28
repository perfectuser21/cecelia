# 独立裁判（第 6 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r6.md
- 总评：本轮两组真实预览操作及已登记Native验证支持其余八条验收。I-7所需生产失败历史仍只有摘要指针、缺原始内容核验，暂不支持合并；本轮QA封存也不等同于已完成登记。

## 需求覆盖

### I-1
- 满足
- 依据：S-1、Q-1覆盖。T-1/T-3真实CLI建单；T-2/T-4逐项比对任务、活动输入、新01及指定Git正文摘要。原生item_63展示四类引用完整字段。authority-refs.mjs:97计算实际摘要，lib/intent.mjs:65渲染引用事实。

### I-2
- 满足
- 依据：S-2、Q-2/Q-3覆盖。T-5确认同路径两版revision与digest不同、回放输入一致；T-2/T-4独立读取Git正文并核摘要，七类错误均拒绝。外部URL返回authority_path_mismatch仍明确拒绝，不构成错误放行。

### I-3
- 满足
- 依据：S-3、Q-1/Q-4覆盖。T-1/T-3的任务ID与T-2/T-4活动输入及API读回一致；旧式任务生成unconfigured，缺required返回authority_required_missing。new-task.mjs:81传递声明，activities/intent.mjs:40校验并阻断。原生item_76的undefined与false断言失败保留，后续按旧任务省略字段的实际语义修正。

### I-4
- 满足
- 依据：S-4、Q-1覆盖。原生item_63的新01保留背景、转义伪I-999并保留两条验收；T-2/T-4重算文件摘要，与本次活动outputs.intent_sha256一致。registry仅增加既有资料引用。受信隔离事实解释本任务03/04暂移并确认原样恢复。

### I-5
- 满足
- 依据：S-5覆盖。已登记verify原生item_16、item_20、item_27核原记录摘要及item93测试变更→94行为断言失败→95实现修改→96通过，并核测试、实现提交；item_25确认当前断言保留。verify item_5实际执行完整命令，8文件194项通过、退出0。此为7581a074阶段执行，非本轮QA重跑。

### I-6
- 满足
- 依据：S-2、Q-2/Q-3覆盖。T-2/T-4的package.json偷换返回authority_path_mismatch，合法旧版回放通过。已登记verify的authority-refs.test.mjs:11包含正确摘要偷换与自造索引拒绝断言，完整运行通过；loadAuthorityIndex与validateAuthority分别约束可信版本和登记路径。

### I-7
- 未满足
- 依据：已登记verify item_5、item_28、item_31支持真实runner子进程的软件回归；T-9符合S-11限定的本轮可见状态检查。但生产历史证据仅见资源索引内的摘要与文件指针，未展示verification_failed及原任务来源失败历史的原始读回内容，尚未闭合r3:J-1。

### I-8
- 满足
- 依据：S-7覆盖。已登记verify item_5显式IPC执行194项并退出0；item_25展示Git replace先证明替换生效，再验证固定索引与正文。默认HTTP分支保留，fetch替换限定测试fixture。结论不代表TCP验收；本轮预览操作另由T-1至T-4证明。

### I-9
- 满足
- 依据：S-8覆盖。已登记原Native verify item_5显式IPC与owned，194项通过；item_28、item_29、item_32核真实detached进程、忽略TERM、expectGone、签名与nonce认证、未认证PID拒绝及finally清理。T-7确认22产品路径仍与固定候选一致；未把历史阶段执行当成本轮QA进程测试。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-7
- 位置：02-spec.md#S-11；05-qa-report-r6.md原生item_5；前轮r3:J-1
- 说明：r3:J-1仍未充分闭合。本轮原生item_5只读取formal-resource-index.json，其中supervisor_production_history_readback列出响应路径、摘要、观察时间和顶层状态：04ad任务为failed，5f802任务为completed，但两者result_reason均为null，result_keys只说明字段存在。材料没有展示所指原始响应或receipt正文，也没有对其摘要和嵌套失败事实的实际核验输出。因此不能确认04ad仍保留verification_failed，也不能确认5f802的source_provenance_missing升级历史未被覆盖；同时不能仅凭completed推断历史已被破坏。须提供监督端实际GET响应中任务身份、嵌套失败原因及历史保留内容，并绑定观察时间与响应摘要。无需让隔离QA或verify访问生产，也无需恢复额外预览runner场景。
