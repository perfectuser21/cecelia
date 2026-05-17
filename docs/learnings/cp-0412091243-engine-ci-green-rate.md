### 根本原因

Engine 版本 bump 需要同步更新 6 个文件（package.json / package-lock.json / VERSION / .hook-core-version / hooks/VERSION / regression-contract.yaml），但 agent 手动操作时频繁遗漏 `.hook-core-version` 和 `hooks/VERSION` 这两个文件，导致 CI Version Sync 步骤失败。

历史上 check-version-sync.sh 也只检查了 5 个文件，没有覆盖 regression-contract.yaml，存在漏检。

### 下次预防

- [ ] Engine 版本 bump 必须使用 `bash packages/engine/scripts/bump-version.sh` 一键同步所有 6 个文件，禁止手动逐文件修改
- [ ] 新测试 `tests/version-sync/version-files-sync.test.ts` 在本地 `npm test` 即可发现版本不同步，不必等 CI
- [ ] 修改 `packages/engine/` 任何文件前，先跑 `bash packages/engine/ci/scripts/check-version-sync.sh` 确认基线一致
