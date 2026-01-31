# QA Decision

Decision: NO_RCI
Priority: P1
RepoType: Business

Tests:
  - dod_item: "Command Center 作为唯一入口"
    method: manual
    location: manual:访问 /command 验证卡片存在
  - dod_item: "VPS 状态显示真实进程数"
    method: manual
    location: manual:比对 pgrep 结果
  - dod_item: "下钻导航"
    method: manual
    location: manual:点击卡片验证 URL 变化
  - dod_item: "API 端点"
    method: manual
    location: manual:curl 验证响应结构

RCI:
  new: []
  update: []

Reason: 这是前端重构任务，主要涉及 UI 布局和导航变更。无核心业务逻辑变更，暂不需要添加回归契约。手动验证页面交互和 API 响应即可。
