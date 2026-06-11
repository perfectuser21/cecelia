# Learning — 快照同步连带打破"断言 skill 文件内容"的旧测试

分支：cp-06110845-harness-test-stale-skill-assert
日期：2026-06-11

## 背景

PR #3334 把 harness skill 快照同步到 SSOT cc8e65f（#50 链路审计），删掉了 skill 里的
`phase-event`/`initiative_run_events`/`ts_end` 等字面，连带让一批「断言 skill SKILL.md
含这些字面」的旧测试在全量 brain 套里变红（15 个，4 个文件）。

### 根本原因

1. **测试断言层级错位**：这些测试把"pipeline phase metrics 被记录"这个行为契约，错误地
   绑在 **skill 文本内容**（SKILL.md 含某字面）上。而真正的 owner 是 Brain 侧
   `events/initiativeRunEvents.js`（图节点生命周期写 initiative_run_events）。skill 侧的
   curl 埋点自 06-04 起就没了、且自始未在生产生效。断言绑错层 → SSOT 一改 skill 文本就误红。
2. **CI 漏网**：brain-unit 用 `vitest --changed`，靠 import 图判定受影响测试；而这些测试是
   运行时 `fs.readFileSync` 读 SKILL.md（不在 import 图）→ 改快照不触发它们 → #3334 CI 绿着
   合了，main 变成 latent 红，只有跑全量 brain 套才暴露。

### 下次预防

- **测试断言要绑在真实 owner / 行为上，不要绑在另一个组件的文本内容上**。要验"指标被记录"
  就断言写库的 Brain 侧代码（INSERT/UPDATE initiative_run_events），不要断言 skill 文本含某字面。
- **同步外部 SSOT 快照属于"会动到被运行时读取文件"的改动**：这类 PR 即使 `vitest --changed`
  绿，也应跑一次全量 brain 套确认没有运行时读文件的测试被打破（snapshot/content 断言类）。
- 跨组件「A 的文本里必须出现 B 的关键字」这种断言是脆弱耦合，识别到就该重构到行为层。

## checklist

- [ ] 测试断言绑真实 owner/行为，不绑另一组件的文本内容
- [ ] 同步 SSOT 快照类 PR 跑一次全量 brain 套（防运行时读文件的 content 断言被打破）
- [ ] 发现「A 文本含 B 关键字」式脆弱断言，重构到行为层
