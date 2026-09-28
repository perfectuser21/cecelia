## Brain {VERSION} — 删除 D 类最后 2 张空表：user_annotations（知识页批注框）/ life_events（看板人生事件路由）

- 迁移 485：删 user_annotations、life_events（非空闸、无 CASCADE、回滚=生产 pg_dump -s）；生产结构副本实测闸拦截/up/down/重放。
- 同 PR 删引用：`routes/user-annotations.js` 与 server 挂载；日记/决策登记/设计库/开发日志 4 个知识页的批注框（从未被用过）；看板服务端 `task-system/life-events.js` 与挂载（无前端调用）及其接口测试段。
- 至此 D 类 16 张处置完毕：删 9 张（484 七张 + 485 两张）；topic_decision_feedback（活回路）待主理人定；org_unit_members 保留；ZenithJoy 授权 4 张空副本待删。
