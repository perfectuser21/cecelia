## 对话原始捕获——机械过滤JSONL真人文本进inbox（2026-07-20）

Alex 发现每天 Claude Code 对话里提到的十几二十个话题，任务当次往往只做完几个，其余没留痕迹被忘掉。要求一个纯机械（零 LLM）的方案：从本机 `~/.claude/projects/*/*.jsonl` 抽取用户真人打字的文本（排除 tool_use/tool_result），10 分钟一轮写入现有 `captures` 收件箱表。

调研发现几乎同名的历史功能"轨道C conversation-digest"（decision a823206d，2026-07-19 刚被退役）：4 个月 `conversation_captures` 表 0 行写入，`conversation_log_cursors` 攒了 118,294 行死指针。挖根因发现是纯工程 bug——`INSERT INTO conversation_captures (source_file, project_slug, capture_type, raw_content, status)` 用的字段跟 migration 194 实际建表字段（`session_id/summary/key_decisions...`）从上线第一天起完全对不上，100% 写入失败，且被 `catch(e){console.warn}` 悄悄吞掉从未被发现。

本次方案：不复用旧表/旧逻辑，直接对接已在生产验证过的 `captures`/`capture_atoms` 体系（`pushCapture()`），并专门针对"失败必须可观测"这条设计目标做验证。subagent-driven-development 三轮独立 code review 中，第三轮（对整个分支做综合审查）用真实 DB 直接验证出一个新的静默丢数据路径：`captures.repo` 是 `varchar(100)`，但代码把 Claude Code 项目目录名（编码完整路径，嵌套 worktree 场景下真实超过 100 字符）原样传入，导致 `pushCapture()`（其契约是"写入失败绝不抛，只 console.warn 返回 null"）静默失败，`errors` 计数不增、`{ok:true}` 照常返回——跟被退役的轨道C是同一种失败形状，只是换了个触发方式。已修复：`repo` 写入前截断到 100 字符 + 对 `pushCapture` 返回 `null` 的路径补 `else` 分支计入 errors + scheduler-jobs 的 job wrapper 同时检查 `errors > 0` 触发失败上报。

### 根本原因
1. 产品设计层面：历史失败功能的死因文档只写了"退役"，没有深挖到具体 bug 是什么，导致重新设计前无法判断"是这个想法本身不行，还是当年实现有 bug"——本次靠读旧代码 diff（`git show <commit>:path`）逐字对比 INSERT 字段和 migration schema 才找到真正根因。
2. 代码层面：`pushCapture()` 的"绝不抛异常"契约是有意设计（防止收件箱写入失败阻塞主流程），但调用方如果只在 `catch` 块里计数错误，会完全漏掉这条契约规定的真实失败信号（`resolve(null)`），造成 try/catch 形同虚设的假安全感。这个 bug 是被 subagent-driven-development 流程里"对整个分支做综合审查"的最后一轮 review 抓出来的，前两个 Task 各自独立审查时都没发现——因为写入循环代码在 Task 1 就写好了，当时还没有真实 DB 集成测试去触发它。

### 下次预防
- [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（`pushCapture`/`claimDedupeKey` 等），review 时应主动搜索"这个函数会不会抛异常"再判断调用方的错误处理是否对得上
- [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit message 的一句话总结——本次靠这个方法把"死因不明的历史教训"变成了"可复现、可规避的具体 bug 模式"
- [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工作模式里，不是边缘 case
