# changes/ — 历史版本条目碎片

Auto Version 已停用，当前不再自动消费本目录。已有碎片仅保留为历史材料，不能作为升版完成的证据。

改动 `packages/brain/src/**` 的候选必须在实现及验收阶段，相对目标 main 提供真实 Brain 版本增量，并同步更新：

- `packages/brain/package.json`
- `packages/brain/package-lock.json` 的顶层及根包版本
- 根 `package-lock.json` 的 Brain workspace 版本
- `.brain-versions`
- `DEFINITION.md` 当前版本

主 CI 的 plan 和 coding-workflow 发布入口均只读校验固定 Git 候选。发布器不自动生成碎片，不在验收后补改版本；校验失败应修复候选并重新验收。
