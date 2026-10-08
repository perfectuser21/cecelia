## Brain {VERSION} — 独立流程契约身份兼容

- activity-contract loader 支持 contract_key 与 canonical capability 分离；独立流程只接受同仓库、唯一 canonical owner 且 capability_id 一致的登记，拒绝缺失、跨能力与歧义归属。
- 增加正式 loader/store/sync 17 项回归与只读 smoke；本变更不登记或激活未完成的获客流程。
