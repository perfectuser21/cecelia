### [2026-03-13] Step 6.5 升级为 Cleanup Sub-Agent（v12.58.0）

**失败统计**：CI 失败 1 次，本地测试失败 0 次（预存在失败，与本次改动无关）

**CI 失败记录**：
- 失败 #1：Learning Format Gate 失败（`docs/learnings/<branch>.md` 文件缺失）
  - 根本原因：Step 10 Learning 必须在第一次 push 之前完成，而不是"CI 通过后再写"。本次 push 时忘记附带 Learning 文件
  - 修复方式：写 Learning 文件后补充 push，CI 重新触发通过
  - 下次如何预防：**Learning 文件和代码 commit 必须同一次 push**，不能分两次

**错误判断记录**：
- 以为可以"CI 通过后再写 Learning，再 push"——错误。Learning Format Gate 在 CI 第一次运行时就检查，必须在初次 push 中包含 Learning 文件

**影响程度**: Low（仅 CI 失败一次，根因清晰，修复简单）

**预防措施**（下次开发中应该注意什么）：
- Learning 文件（`docs/learnings/<branch>.md`）必须和代码变更放在**同一个 commit** 中，初次 push 时一起提交
- 不要等"CI 通过后再补 Learning"——Learning Format Gate 是 L1 的一部分，初次 push 就会触发
- 改 `packages/engine/skills/dev/steps/` 文件时，这本身不是"功能代码"，测试失败是预存在的平台兼容性问题（macOS `stat -c %a` 不支持），不是本次引入的
