# Learning: Step3 DoD Test 门禁实现

**分支**: cp-03171250-aa8cd5be-2a32-4652-b6c0-7a536d
**任务**: Step3 push前强制执行DoD Test命令

## 什么被修复了

在 `packages/engine/skills/dev/steps/03-prci.md` 的 8.4（提交）和 8.5（push）之间新增了 `8.4.5 DoD Test 门禁` 章节。
同时新增了 `9.3b 发现并行 PR 已合并同功能` 章节，补充关闭并行 PR 前的 DoD 验证逻辑。

## 根本原因

原来 Step 3 中缺少本地 DoD Test 执行步骤，导致 `manual:` 命令从未在 push 前被本地运行，
只有 CI 才能发现 DoD 验证失败。这增加了无效 push 的频率和 CI 等待时间。

## 下次预防

- [ ] 写 DoD Test 命令时，确保命令格式为 `manual:bash -c "..."` 或 `manual:node -e "..."` 而不是裸 `grep -c`（macOS grep 不支持 `-P`，且 `detectFakeTest` 要求必须含 `bash/node/curl` 等关键词）
- [ ] `[BEHAVIOR]` 类 DoD 条目不能用 `bash -c "grep ..."` — 会被 `isWeakOnly` 检查拒绝；改用 `node -e "..."` 或 `curl` 验证
- [ ] DoD 至少要有 1 个 `[BEHAVIOR]` 条目，全是 `[ARTIFACT]` 会在 Phase 0 被 check-dod-mapping.cjs 拒绝
- [ ] branch-protect hook 要求 `.dev-mode.{branch}` 文件中包含 `tasks_created: true`，否则写代码会被阻止
