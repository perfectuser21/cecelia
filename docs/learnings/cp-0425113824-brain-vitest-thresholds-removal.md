# Learning: Brain vitest thresholds 与 diff-cover 二选一

### 根本原因

`packages/brain/vitest.config.js` 同时配 `coverage.thresholds`（全局阈值 75/75/80/75）和 CI 又跑 `diff-cover --fail-under=80`。当 brain 全局覆盖率（约 67%）低于 vitest threshold 时，第一步 `vitest run --coverage` 直接 exit 非 0，第二步 `diff-cover` 永远不执行，造成"PR 新代码 100% 覆盖也被卡死"的错觉式 fail。

错配根源：vitest threshold 是 repo-level 全局门禁，diff-cover 是 PR-level 增量门禁。两者目标不同，但因 vitest fail 阻断后续 CI step，全局门禁的 noise 把增量门禁的信号完全淹没。

### 下次预防

- [ ] 凡 CI 流程把覆盖率门禁交给 diff-cover（PR-level），vitest 端就不要再开全局 thresholds，避免双重门禁互相打架
- [ ] 若想新增"全局覆盖率不可低于 X"硬底线，应另起独立 job（lcov + bash 计算），不要复活 vitest 全局 threshold
- [ ] 调整 CI 覆盖率门禁前必须画 mental model：第几步 fail 决定后续步骤是否执行；前一步阻断 == 后一步永不发声
- [ ] CI 任何"门禁配置"改动必须 PR 自身跑一遍证明能跑到目标 step，不能只看 lint
