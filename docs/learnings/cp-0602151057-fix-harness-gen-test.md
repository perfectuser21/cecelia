# Learning: 契约测试不该硬锚外部 user skill 的版本号/措辞

## 背景
worktree-isolation-gate PR push 时，本机 pre-push QuickCheck 被 `packages/engine/tests/skills/harness-generator.test.ts` 永久卡住（2 个断言失败），阻塞本机所有 engine push。关联 Issue da2427d8。

### 根本原因
该测试读 `~/.claude/skills/harness-generator/SKILL.md`（本机 symlink → zenithjoy-skills repo），并硬锚 skill **v7.0.0** 的具体措辞与版本号：
- 断言 frontmatter version 含 `7.0.0`，但 skill 已在 zenithjoy-skills 独立演进到 **v7.3.0**
- 断言 `/禁止自写.*sprint-contract/`，但 skill 已改读 contract-draft.md，措辞变为「合同外一字不加」

cecelia 的契约测试与 zenithjoy-skills 的 skill 跨 repo，skill 独立演进 → cecelia 测试必然漂移。CI 因 `skipIf(!skillExists)`（headless 无 symlink）跳过不受影响，但本机有 symlink → 测试实跑 → 永久失败。

### 下次预防
- [ ] 跨 repo 契约测试禁止 hardcode 外部 skill 的具体版本号——只验证 semver 格式存在
- [ ] 禁止断言外部 skill 的易变措辞——只验证稳定不变量（如 CONTRACT IS LAW、superpowers 引用、禁止事项段存在）
- [ ] 引用外部资源（symlink/另一 repo）的测试，本机与 CI 行为会因资源存在性分叉，设计时必须考虑两种环境
- [ ] 发现 pre-push 被无关 pre-existing 测试阻塞时，先确认是否在本次 diff，再决定单独 issue/PR 而非塞进当前 PR
