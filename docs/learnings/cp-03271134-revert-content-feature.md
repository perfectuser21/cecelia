# Learning: 回滚 Cecelia Dashboard content feature

## 变更概述
删除错误添加到 Cecelia Dashboard 的 content feature，该功能应在 ZenithJoy Dashboard（香港 VPS 5211）。

### 根本原因
Cecelia Dashboard 是系统监控面板（Brain 状态、任务路由、Area 配置等），只有系统管理员使用。
ZenithJoy Dashboard 才是面向员工的生产工具（内容工厂、新媒体运营、AI 员工等），部署在香港 VPS。
错误地将面向员工的功能放在了系统管理面板中，员工无法访问。
ZenithJoy Dashboard 已有 ContentFactoryPage.tsx（774 行完整页面），只需更新 pipeline 阶段常量。

### 下次预防
- [ ] 涉及"员工使用"的功能必须放 ZenithJoy Dashboard（/Users/administrator/perfect21/zenithjoy/apps/dashboard/）
- [ ] Cecelia Dashboard 只放系统监控和配置功能
- [ ] 开发前先确认目标 Dashboard 是哪个：Cecelia（系统）vs ZenithJoy（业务）
