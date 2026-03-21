# Learning: SelfDrive 接入全量感知数据

## 变更概要
扩展 self-drive.js 的 buildAnalysisPrompt()，从只读 Probe+Scanner 扩展为全量感知（KR 进度、任务完成率、Dopamine 满足感、活跃 Projects）。同时将默认执行频率从 30 分钟改为 4 小时。

### 根本原因
SelfDrive 作为 Cecelia 自驱引擎的核心决策模块，只看系统健康数据（Probe/Scanner）而忽略业务进展数据（KR/任务/满足感/Roadmap），导致决策视野片面。无法发现 KR 进度落后、任务成功率下降、满足感低迷等业务层面的问题。

### 下次预防
- [ ] 新增 Brain 感知模块时，同步检查 SelfDrive 是否需要接入该数据源
- [ ] 修改测试 mock 时注意 pool.query 调用顺序——新增查询会影响所有下游 mock 的序号
- [ ] Dopamine 模块导出的是 `getRewardScore` 不是 `getDopamineScore`，引用前先确认 API 名称
