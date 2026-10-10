## Brain {VERSION} — 正式确定性脚本使用代码主机容量，不被 AI 配额和并发误伤

- 生产手机巡查不调用 LLM，但曾被 AI 池满、配额冷却与优雅降级阻塞。中央 tick 每轮最多派一条 `runtime_requires_llm=false` 且关联 active 正式 Workflow 的 script_run，代码运行不计入 AI 并发池。
- 保留停止开关、紧急暂停、显式软硬依赖与既有脚本主机并发/熔断/原生设备锁。只绕过同项目人工研发活动的无关互斥，四手机独立任务依赖仍为明确 `depends_on:[]`。
- 目标机器健康报告过期、离线或真实 CPU/内存压力过高仍等待；事件保存原始拒绝原因、压力与采样时间。纯代码声明与 requires_cortex=true 冲突时不进入代码选择。
