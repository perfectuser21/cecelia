# Learning: 重设计 TaskTypeConfigPage — 全量任务表+真实设备名

**Branch**: cp-03222012-redesign-task-type-page
**Task**: 62add8cf-c0cb-4a4b-b20c-fdfb257705bd

### 根本原因

原页面只显示 5 条动态配置行（从 DB 加载），没有展示 LOCATION_MAP 里全部 30+ 个任务类型，设备标签也用抽象的 us/hk/xian 而非真实设备名，用户无法一眼理解任务路由的全貌。

### 解决方案

1. 将 LOCATION_MAP 的所有任务类型静态内嵌为 `STATIC_GROUPS`（6个分组：A类开发执行、B类Coding Pathway、西安Codex机群、香港VPS、内容工厂）
2. 动态配置 5 条（B类纯策略）仍从 `/api/cecelia/task-type-configs` 加载，行内可编辑
3. 设备标签改为 `DEVICE_LABELS`：`us→美国M4, hk→香港VPS, xian→西安M4`
4. 页脚注明西安PC（CDP被控端）和西安M1（L4 CI Runner）不参与任务路由

### 下次预防

- [ ] 页面展示设备信息时，始终用真实设备名（美国M4/香港VPS/西安M4），不用 us/hk/xian 原始键
- [ ] 新增任务类型到 LOCATION_MAP 时，同步更新 TaskTypeConfigPage 的 STATIC_GROUPS 静态数据
- [ ] 固定路由行只读（无编辑按钮），动态配置行明确标注可编辑（黄色背景 + ● 标记）
- [ ] 页面中应展示设备图例（设备名 + 原始键 + IP说明），帮助用户快速对应
