## Brain {VERSION} — 既有发布工作流来源 CAS 登记与真实能力核验

- 内部鉴权 `/workflow-authoring/sources/register` 只给精确 UUID 的现有工作流登记固定 Git 来源，核 commit/tree/blob 字节、合同身份、真实能力、旧来源和同步 revision；并发冲突或回读失败整体回滚，不创建活动、不激活执行。
- 合同 `contract_key` 与能力 `capability` 分开核验：有真实 `capability_code` 时直接对照规范能力，旧注册仍保留原 owner 协议；不要求创建虚构的共同 owner 流程。
- 快照来源消费者保留 v1 格式；显式合同使用实际工作流身份和规范能力校验， loader 使用已校验 owner 的真实能力，不制造共同 owner。
