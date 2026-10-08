## Brain {VERSION} — 固定定义快照独立保留契约来源owner

- 独立冻结中央当前来源登记及业务owner树闭包，带独立摘要，不将无同SHA定义的retired owner冒作固定定义。
- 契约验证只验证已有固定定义的消费者，引用解析使用完整来源owner；scratch导入不为仅来源owner伪造current指针。
- 来源篡改、缺owner、跨仓库或业务能力不匹配时拒绝；保留原定义和地图未知缺口。
- 真实额外业务映射以独立owner树核验；来源、实体、固定SHA或父价值流错误仍为UNKNOWN，不补造定义。
