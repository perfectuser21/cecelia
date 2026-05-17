# Learning: 发布决策层 Fast/Safe Lane 风险分级

**Branch**: cp-04052027-engine-fast-safe-lane
**Date**: 2026-04-05

---

### 根本原因

`deploy.yml` 所有 PR merge 后走同一条路直接 deploy production，不区分风险高低。
Brain 核心编排文件（thalamus/tick/executor/migrate 等）与普通配置改动享受同等待遇，没有缓冲保护。

### 修复内容

1. `changes` job 新增 `risk_level` output（high/low），检测 8 个高风险路径
2. 新增 `risk_gate` job：Fast Lane 自动 pass，Safe Lane 输出 `::error::` 阻断 deploy
3. `deploy` job 改为依赖 `needs: [changes, risk_gate]`，Safe Lane 时不执行
4. `[SAFE-DEPLOY]` commit message bypass 机制：紧急情况可强制走 Fast Lane

### 下次预防

- [ ] 新增 Brain 核心文件时，同步更新 `SAFE_LANE_PATTERN` 正则
- [ ] Safe Lane 阻断后，应通过 `git commit --allow-empty -m 'chore: [SAFE-DEPLOY] ...'` 手动确认部署
- [ ] 高风险改动上线前建议先在本地跑 `bash scripts/verify-deployment.sh` 验证

### 注意事项

- 第一次 push（BEFORE 全零）默认走 Fast Lane，不做高风险检测（属预期行为）
- Workspace（apps/）改动永远是 Fast Lane，只有 Brain 核心文件才触发 Safe Lane
