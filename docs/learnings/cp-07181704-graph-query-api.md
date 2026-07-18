# Learning: 刀A2 索引服务五查询端点

### 根本原因
图(刀A1)只是数据,AI 用不上——缺"开工问路/波及点名/认领判据"的机械查询面。锚点大多指向 zenithjoy-workspace(本仓图罩不住),端点必须三态诚实(covered/uncovered/unanchored),否则会拿半张图冒充全图。

### 下次预防
- [ ] 半覆盖数据做查询服务必须显式呈现覆盖率与三态,禁把 unmatched 静默当不存在(假阴性)
- [ ] journey_features 有 Notion 自动 push,任何测试禁往里插行——语义表的测试一律 fixture 行走单测
- [ ] 查询端点对空数据源必须优雅(空结果+stale 标记),CI smoke 依赖此行为
- [ ] 数值参数默认值判断禁用 `|| 默认`(0 是 falsy 会被吞)——radius max_depth=0 陷阱本刀审查抓到,显式 `== null` 判断
