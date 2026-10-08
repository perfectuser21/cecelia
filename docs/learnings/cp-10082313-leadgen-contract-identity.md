## 同一能力的独立流程契约身份（2026-10-08）

### 根本原因
原契约 loader 将文件名、流程来源 key 和业务 capability 强制视为同一标识。拆分流程后需要独立冻结版本，但仍属于既有业务能力。显式 contract_key 解决执行身份，不能同时放松 capability 归属约束。

### 下次预防
- [x] 永久 loader 回归覆盖独立身份正确加载与跨能力拒绝。
- [x] canonical owner 必须唯一，缺失、跨仓库和歧义登记全部拒绝。
- [x] 退役流程的 owner 事实用于归属校验，不表示重新激活；激活必须另行正式登记与版本发布。
- [x] smoke 直接执行正式 loader/store/sync，登记到 CI allowlist；本刀不激活尚未交付的四流程。
