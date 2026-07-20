# Initiative DoD: 对话原始捕获（conversation raw capture）

- Initiative: `5402c2e5-975a-41ac-9a5c-e07184aa2d7c`
- architecture.md: `docs/architecture/2026-07-20-conversation-capture/architecture.md`

## 功能验收条件（Mode 3 逐条检查）

- [ ] F1: `extractUserTurns(filePath, sinceMs)` 对给定 JSONL 文件，只返回 `role=user` 且 content 为纯文本（非 `tool_result`）的轮次，正确排除 assistant 消息与 tool_result 伪装成 user 的消息 — 验证方式: 单元测试，固定 fixture 断言输出集合
- [ ] F2: `routes/captures.js` 的 `VALID_SOURCES` 接受 `'conversation'`，非法 source 仍被 400 拒绝 — 验证方式: 单元/契约测试
- [ ] F3: `runConversationCapture(pool)` 跑一次后，真实（scratch）DB 的 `captures` 表出现 `source='conversation'` 的新行，`content` 与 fixture 原文一致 — 验证方式: 集成测试，直接查表断言
- [ ] F4: 同一份会话文件被扫描两次（模拟轮询重复触发），`captures` 表不产生重复行（dedupe_key 幂等生效） — 验证方式: 集成测试，跑两次 `runConversationCapture` 断言行数不变
- [ ] F5: 未发生变化（mtime 早于上次成功扫描时间）的 `.jsonl` 文件不会被重新解析 — 验证方式: 集成测试或单元测试注入 mock fs stat
- [ ] F6: 写入失败（如异常内容）不抛出、不中断整轮扫描，失败计数写入 `working_memory` sentinel 可被观测 — 验证方式: 集成测试人为触发一次异常路径，断言函数正常返回且 `errors > 0`
- [ ] F7: `conversation-capture` job 已注册进 `scheduler-jobs.js` 的 `JOBS` 数组，遵循现有 10 分钟自 gate 模式 — 验证方式: 读代码确认 + smoke 测试断言 job 名单包含它

## 集成测试通过条件

- [ ] I1: 集成测试全部通过（Task 2 的测试套件）
- [ ] I2: `scheduler-jobs.js` 现有 smoke 测试（`scheduler-jobs-smoke.sh` 一类）在新增 job 后仍然全绿

## 架构对齐条件（Mode 3 自动校验）

- [ ] A1: 未新建任何数据库表（对照 architecture.md「数据模型变更」——只改 `VALID_SOURCES` + `working_memory` 新 key）
- [ ] A2: `packages/brain/src/conversation-capture.js` 存在，导出 `extractUserTurns`/`runConversationCapture`
- [ ] A3: 未复用/未重新引用任何 `conversation_captures`/`conversation_log_cursors` 相关代码或表名
- [ ] A4: 关键决策已落地——零 LLM 依赖（grep 确认模块不 import cortex/LLM 调用）；未修改 `~/.claude` hook 配置或 `packages/engine`

## 非功能条件

- [ ] N1: 无新增 L1 bug（code_review 无 BLOCK）
- [ ] N2: Brain CI 全通过（含 DevGate 三闸：facts-check / check-version-sync / check-dod-mapping）
