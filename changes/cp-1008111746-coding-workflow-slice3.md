## Brain {VERSION} — coding workflow 第三刀：build 写代码 + verify 独立验收

- coding workflow 契约扩为七活动：intent → spec → build → verify → chain_check → publish → report。
- 新增 build 活动（claude 按 02-spec 的 S-n 以 TDD 写代码并在当前分支提交，写 03-build.md；后置检查 build_report_missing / build_no_commit / build_uncommitted；budget 2400s，不自动重试）。
- 新增 verify 活动（全新 claude 会话只拿 01-intent，对每条 I-n 真实运行命令取证写 04-evidence.md；程序按 verdict 判分，FAIL 即 fatal verification_failed 并带失败证据；budget 1200s）。
- claude 子进程公共逻辑抽到 lib/claude.mjs（spec/build/verify 共用）；新增 lib/evidence.mjs 解析 04-evidence。
- md 链校验改为数据驱动，支持 01–04 四文件链（新增 step_mismatch、<file>_not_covered:<ID>），chain_check 从上下文取应存在的链文件。
- publish 的 PR 正文追加每条 I-n 的验收摘要；链含 03-build（有代码提交）时标题用 feat/fix(workflow): <01-intent 标题>。
- verify 运行中 HEAD 变化判 fatal verify_head_moved，并禁 git reset/checkout/rebase。
- 防篡改与防误操作：intent/spec 产出 md 链 sha256，spec/build/verify 发现 01/02 被改或 build 提交触及 sprint 目录判 chain_tampered；build/verify 前后比对远端分支（remote_changed）并剥离 GH 凭据；build 改写历史/切分支判 build_history_rewritten，触及 .claude/CLAUDE.md/AGENTS.md 判 build_touched_agent_config，03 不合规判 build_report_invalid。
- verify 运行期间把 03-build.md 移出 sprint 目录并禁读，--setting-sources user；用 stream-json 执行记录核对每条证据的命令与输出，对不上判 evidence_unverified。
- 远端/祖先/改动清单查询失败判 retryable（remote_check_failed / git_check_failed），不当成正常结果；build 在 sprint 目录留下 03 以外的新文件判 build_sprint_polluted；verify 被取消/超时/中断时也放回 03（失败报 build_report_restore_failed），claude 默认超时为检查阶段预留 90s。
- 验收失败结论写入 outputs.verification，report 在没有 PR 时也把失败条目回写 Brain result.coding_workflow。
