# T9: learnings 表噪音过滤 + 摘要可靠性

### 根本原因
- learnings 表 summary 覆盖率 6% 的根因不是 generateL0Summary 失败（它是纯截断），
  而是 6 条写入路径里 4 条 INSERT 根本没带 summary 列——"低成功率"是列缺失，不是函数缺陷。
- 事件层噪音（task_completion / task_completed_auto，共 106 行 + dev_experience 无摘要 6211 行）
  与 tasks 表信息完全重复，淹没原子准则层。
- 任务描述假设"dispatch-helpers RCA 路径是噪音主因"被数据证伪（仅 4 行）；
  真噪音在 execution callback 与 auto-learning 事件层。修前先量化来源分布避免修错靶子。

### 下次预防
- [ ] 新增 learnings INSERT 路径必须带 summary（t9-noise-source-removed.test.js 源码守卫已卡两处，新增路径时补断言）
- [ ] "某表某列覆盖率低"类问题先按 category/trigger_event 分组统计定位写入方，再谈修函数
- [ ] 自动建任务的闭环机制（Insight-to-Action）必须带置信门槛，无条件触发=任务队列噪音
