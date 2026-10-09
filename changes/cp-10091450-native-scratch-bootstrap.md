## Brain {VERSION} — 原生准入隔离地图重放与惰性扫描依赖

- 仅真实 scratch 内重放冻结 Factory 地图，保持原决定锚点及 active 指针 CAS；无中央 decisions 输入时仍可完成候选准入。生产地图登记与消费者执行守卫不变。
- 冻结定义图读取不加载扫描器，实际图扫描才加载依赖；永久保留 Brain-only 导入与真实 PG 浅 Git/CAS/非 scratch 拒绝回归。
