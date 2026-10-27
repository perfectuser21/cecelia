## Brain {VERSION} — 派发模板与秘密分离

- 两租户默认模板保留原非敏感参数，随 Brain 发布，移除 US 旧 dispatch 挂载。
- control_token 仅从 1Password 受管的私有缓存按 tenant_id 注入；未知模板、内嵌秘密、跨租户声明、路径逃逸与不安全缓存均拒绝。
- 保留显式外部模板扩展及 Brain Notion 同步/派发业务。真实迁移比对通过，验证不外发。
