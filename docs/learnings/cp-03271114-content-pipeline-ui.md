# Learning: Dashboard 内容工厂页面

## 变更概述
在 Dashboard 新增内容工厂（Content Pipeline）页面，让员工通过 UI 发起和监控 6 步内容制作流程。

### 根本原因
Brain content pipeline 后端 6 步流程已就绪（PR #1608），但只有 API 入口没有前端 UI。员工无法直观地发起和监控内容制作。

### 下次预防
- [ ] feature manifest 的 navGroups icon 必须是 Lucide 图标名称（如 Factory、Pencil），不能用 emoji
- [ ] Dashboard 新页面只调现有 Brain API，不需要改 Brain 代码
- [ ] content feature 的 order=5 放在 work(3) 和 knowledge(7) 之间，导航位置合理
