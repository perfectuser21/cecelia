# 小改动 PrepPRD：对话原始捕获——从 Claude Code 会话文件里机械抽取用户原话进 inbox

## 改什么
新建 `packages/brain/src/conversation-capture.js`（抽取器 + 定时任务入口），改 `packages/brain/src/routes/captures.js`（`VALID_SOURCES` 加 `conversation`），改 `packages/brain/src/scheduler-jobs.js`（`JOBS` 数组注册新 job）。

## 为什么改
Alex 每天用 Claude Code 对话时会提到十几二十个话题/想法，任务当次往往只做完其中几个，其余的没留痕迹被忘掉。方案：纯机械（不进 LLM）从本机 `~/.claude/projects/*/*.jsonl` 里筛出 `role=user` 的真人文本轮次（排除 `tool_use`/`tool_result`），10 分钟一轮扫描写入现有 `captures` 收件箱表（新 `source=conversation`），Alex 可在 Dashboard 收件箱回看。

## 关联上下文
- Decision f64adaaf-5313-4d1c-95a4-e4822de4b7f6（本次方案拍板）
- 对照的历史失败：decision a823206d（2026-07-19，`conversation-digest.js`"轨道C"退役）——根因是 INSERT 字段与建表字段从第一天起完全对不上，100% 写入失败且被静默吞掉 4 个月。本次方案不复用旧表/旧逻辑，直接对接已在生产验证过的 `captures`/`capture_atoms` 体系。
- Initiative: `5402c2e5-975a-41ac-9a5c-e07184aa2d7c`，architecture.md: `docs/architecture/2026-07-20-conversation-capture/architecture.md`，initiative-dod.md 同目录。

## 影响范围
- 新增文件，不改动任何现有表结构（`captures`/`working_memory` 字段值域扩展，非 schema 变更）。
- `scheduler-jobs.js` 新增一条 job，不影响其余 21 个已注册 job（各自独立 try/catch 隔离）。
- 无 LLM 调用，无外部凭据依赖。

## 验收标准（对应 initiative-dod.md F1-F7 + I1/I2）
- [ ] `extractUserTurns` 单元测试：固定 fixture 正确区分真人文本 / tool_result 伪装的 user 消息 / assistant 消息 / 格式损坏行
- [ ] `VALID_SOURCES` 契约测试：`conversation` 被接受，非法值仍 400
- [ ] 集成测试（真实/scratch DB）：`runConversationCapture` 跑一次后 `captures` 表出现 `source=conversation` 新行，内容正确
- [ ] 集成测试：同一 fixture 再跑一次，行数不重复（dedupe_key 幂等）
- [ ] 集成测试：mtime 早于上次成功扫描时间的文件不会被重新解析
- [ ] 集成测试：人为制造一次写入异常，函数不抛出、`errors` 计数非零、sentinel 可查到
- [ ] scheduler-jobs 现有 smoke 测试更新后仍全绿
- [ ] CI 全绿
