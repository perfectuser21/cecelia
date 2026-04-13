# Learning — KR3 配置状态更新（post-PR#2329）

**Branch**: cp-0413094521-98f59188-9b0e-4612-9df2-b76889
**Date**: 2026-04-13

### 根本原因

Brain 派发 KR3 配置任务（商户号 + OpenID）时，实际阻断项是两类性质不同的问题：

1. **可代码化（已解决）**：管理员 OpenID 替换 → miniapp `checkAdmin` 三层 fallback 内置（PR#26/#27 已合并）
2. **不可自动化（待人工）**：微信商户号申请 → 需在微信商户平台人工注册，CI 无法代替

### 下次预防

- [ ] SelfDrive 派发 KR 配置类任务前，先检查 Brain DB 中是否已有对应 `kr3_*` 标志
- [ ] 已被标记为"需人工操作"的 KR 阻断项，Brain 不应再重复 dispatch dev 任务
- [ ] 在 `kr3-config-checker.js` 的检测结果中加入 `blockReason: 'human_action_required'` 字段，供 thalamus 判断是否跳过 SelfDrive 重试
