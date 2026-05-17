# Learning: War Room 重构为 Summary + Area 详情页

### 根本原因

旧版 War Room 把不同语境（Cecelia 基建 vs ZenithJoy 内容）的数据混在一个列表，
导致信息密度低、逻辑混乱。Vision 横幅用 shrink-0 但未限高，
测试数据多时（10+ Vision 节点）直接把下方内容区挤没。

### 解决方案

引入 Summary + Area 详情页两级结构：总览页只显示活跃 Vision 一行 + Area 卡片网格；
详情页 `/gtd/warroom/:areaId` 展示该 Area 下的 OBJ→KR + 任务，各 Area 语境隔离。

### 下次预防

- [ ] War Room 类仪表盘：先问"有哪几个独立语境"，不同语境不要混在一个列表
- [ ] Vision/Area 层级展示：只显示 `status === 'active'` 的节点，永远过滤掉 cancelled 和测试数据
- [ ] shrink-0 容器：内容高度不确定时必须加 `max-h-xxx overflow-hidden`，或改为固定单行
- [ ] 路由参数获取：`useParams<{ paramName: string }>()` + `react-router-dom`，参考 ProjectDetail
