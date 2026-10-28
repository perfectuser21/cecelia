# 独立裁判（第 3 轮）

- 裁决：**FAIL**（qa_insufficient）
- 模型：gpt-6-astra
- 复核的 QA 报告：05-qa-report-r3.md
- 总评：本轮真实预览操作已覆盖引用解析、错误拒绝、字段传递和新01摘要；已登记原生verify支持历史TDD及194项回归。生产旧失败任务的独立读回仍缺失，I-7不能通过，暂不支持合并。

## 需求覆盖

### I-1
- 满足
- 依据：S-1、Q-1覆盖。QA T-1/T-2及原生命令item_22、item_23、item_30展示同一新任务的payload、intent输入和新01，四类引用字段完整，Git正文摘要独立复算一致。authority-refs.mjs:97及lib/intent.mjs:65负责读取、计算和渲染。

### I-2
- 满足
- 依据：S-2、Q-2/Q-3覆盖。T-3证明同路径两版摘要不同且旧版回放一致；T-4展示七类错误均明确失败。原生记录item_28、item_31的未就绪失败被保留，后续item_34至item_36才取得完整结果。

### I-3
- 满足
- 依据：S-3、Q-1/Q-4覆盖。真实CLI输出任务358b24a1，独立GET的声明与原生intent输入一致；T-5证明旧任务输出unconfigured、缺required引用返回authority_required_missing。new-task.mjs:81及activities/intent.mjs:40实现传递和阻断。

### I-4
- 满足
- 依据：S-4、Q-1覆盖。item_30的新01保留背景、转义伪I-999并保留两条验收；T-2复算摘要e8782497…与本次原生outputs.intent_sha256一致。索引仅登记既有资料路径；受信隔离事实确认本任务03/04已原样恢复。

### I-5
- 满足
- 依据：S-5覆盖。已登记verify原生item_16、item_20、item_27核对原记录摘要及item93→94行为断言失败→95实现修改→96通过，并识别测试与实现提交；item_25核当前同断言保留。verify item_5实际执行完整命令，8文件194项通过、退出0。该证据属于7581a074阶段，不冒称本轮QA执行。

### I-6
- 满足
- 依据：S-2、Q-2/Q-3覆盖。T-4的package.json偷换返回authority_path_mismatch，T-3证明合法旧版本回放；已登记verify的authority-refs测试包含正确摘要偷换和未固定索引自封拒绝断言，完整运行通过。

### I-7
- 未满足
- 依据：已登记verify item_5及item_28、item_31支持真实runner子进程的软件回归；QA X-1仅证明本轮intent场景未冒充workflow完成。材料未提供S-11明确要求的监督端生产旧失败任务独立读回。

### I-8
- 满足
- 依据：S-7覆盖。已登记verify item_5显式IPC运行完整套件，194项通过；item_25展示Git replace先确认替换生效再核原索引和正文的断言。默认HTTP分支保留，生产fetch未被替换；此结论不代表TCP验收，也不替代本轮预览操作。

### I-9
- 满足
- 依据：S-8覆盖。已登记原Native verify item_5显式IPC及owned，194项全部通过；item_28、item_29、item_32对应真实detached进程、忽略TERM、expectGone、签名与nonce挑战、拒绝未认证PID及finally清理。T-7确认相关22个产品blob仍等于固定候选；不将该历史阶段执行称为本轮QA进程测试。

## 问题

### J-1
- 类型：qa_gap
- 严重度：重要
- 对应：I-7
- 位置：02-spec.md#S-11；05-qa-report-r3.md#X-1；historical_execution.verify
- 说明：S-11明确规定，独立judge还必须取得监督端对生产旧失败任务的独立读回，缺任何一项则I-7不能通过。所给材料没有04ad910f-8c5f-4b9d-b31c-962128f2dc0b仍保留verification_failed的实际查询响应，也没有原任务5f8029c7的失败历史保留读回。需求背景中的声明、runner夹具回归，以及X-1中13条预览场景的in_progress状态均不能证明生产旧失败未被覆盖。应补充监督端只读查询的任务身份、状态、失败原因和观察时间；无需让禁网verify访问生产，也无需恢复已移除的额外预览runner场景。
