## ZenithJoy CI 补全：5 个测试质量 lint 门禁 + deploy 修复（2026-04-27）

### 根本原因

ZenithJoy CI 缺失所有测试质量 lint 门禁（无 feat/test 配对检查、无 TDD 顺序检查、无假测试拦截），且 deploy.yml 仍引用已全部禁用的 HK VPS runner（2026-03-17 禁用），导致部署 CI 永远卡死、无失败告警。

### 下次预防

- [ ] 新仓库上线时对标 Cecelia CI 5-gate 框架，PR 1 就写 lint 门禁
- [ ] deploy.yml 使用 self-hosted runner 时，必须确认 runner 处于 active 状态再合并
- [ ] 从 Cecelia 移植 bash 脚本时，注意 `.ts` 扩展名适配（`.js` → `.ts`）和双布局测试目录（`src/__tests__/` + `apps/api/tests/`）
- [ ] subagent 实现 bash 脚本时不要创建额外 worktree，直接在工作目录提交；否则 staging area 会出现预期外删除标记
- [ ] `grep -c` 统计 vi.mock 次数时，若多个调用在同一行会只算 1 次；多 occurrence 统计应用 `grep -o | wc -l`
- [ ] Rule C（全 .skip 拦截）正则 `(it|test)\s*\(` 不匹配 `it.skip(`；正确写法：`(it|test)(\s*\(|\.skip\s*\()`

### 产出

- ZenithJoy PR #222：5 个 lint 脚本 + ci-l1-process.yml 追加 5 jobs
- ZenithJoy PR #223：deploy.yml runner ubuntu-latest + on_deploy_failure Brain P0 告警
