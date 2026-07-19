# 小改动 PrepPRD：Inbox统一捕获P0清场——退役conversation-digest与capture-digestion两条死链路

## 改什么
1. 删除 `packages/brain/src/conversation-digest.js` + `scheduler-jobs.js` 中 `conversation-digest` job 注册
2. 删除 `packages/brain/src/capture-digestion.js` + 其 job 注册（tick.js 或 scheduler-jobs.js 中的调用）
3. 新增 migration：DROP `conversation_captures` 与 `conversation_log_cursors` 两表
4. 删除 `packages/brain/src/routes/conversation-captures.js` 路由 + server.js 挂载
5. 清理两模块对应测试文件与所有残留引用
6. `selfcheck.js` EXPECTED_SCHEMA_VERSION 同步 bump

## 为什么改
- conversation-digest：4个月零成功写入（conversation_log_cursors 58,969条error），目标表字段错位从未写通；conversation_captures 全库0行，无任何调用方/消费方；职能已被 Notion 会话总结 skill + Claude Code 原生 auto-memory 接管
- capture-digestion：轨道A的6类LLM拆解，captures表全库仅2行，形同虚设
- 决策锚点：decisions a823206d（Alex 07-19 拍板）；Spec：docs/superpowers/specs/2026-07-19-inbox-unified-capture-design.md P0

## 关联上下文
- Journey：Cecelia Harness Pipeline（bb8cc561）
- Brain task：8c693757-0d1b-4013-ad51-109ae96b0e21（已claim）
- 历史决策匹配：无冲突；GitHub撞车检查：无相关open PR

## 影响范围
- 保留项（明确不动）：`captures`表（未来统一inbox的L0入口）、`capture_atoms`表、`capture-inbox.js`、`capture-triage.js`及其job
- 两表DROP无数据损失：前者0行，后者全是过期文件路径指针
- Brain 改动 → 触发 brain-ci.yml；合并后 Gate3 自动部署

## 验收标准
- [ ] tick/scheduler 日志不再出现 conversation-digest 与 capture-digestion 两个 job
- [ ] migration 执行后两表已 DROP（本地验证用 DB_NAME=cecelia_scratch）
- [ ] 全 repo grep 无残留引用（conversation-digest / conversation_captures / conversation_log_cursors / capture-digestion / runCaptureDigestion / runConversationDigest）
- [ ] node --check 通过；全量测试绿；CI 全绿
- [ ] EXPECTED_SCHEMA_VERSION 与新 migration 号一致
