# Learning: KR3 状态文档更新 + 外部阻断识别

**Branch**: cp-0414224938-e1c64e7f-b339-44d7-a591-fa0912
**Date**: 2026-04-15

---

### 根本原因

Brain 将 `allReady: false`（WX Pay 未配置）作为任务重派依据，导致任务被无限重调度。
管理员 OpenID 问题已通过三层 fallback 解决，但 WX Pay 依赖外部商户号申请，属于**外部阻断**，代码层面无法自动解决。

### 下次预防

- [ ] 对于外部阻断项，在状态文档中明确标注"外部阻断"与"待操作"的区别
- [ ] Brain 自驱任务调度时，识别"外部阻断"状态，避免重复派发无法推进的 dev 任务
- [ ] WX Pay 商户号申请完成后，执行 `bash scripts/kr3-setup-wx-pay.sh --mark-done` 通知 Brain

### 关键决策

1. 管理员 OpenID `o2lLz62X0iyQEYcpnS2ljUvXlHF0` 即为正式环境值（Alex 的真实 WeChat OpenID）
2. WX Pay 配置工具链已完整（私钥 ✅，setup 脚本 ✅），只差外部申请步骤
3. 灰度部署阶段 1a（非支付功能内测）可以在商户号申请期间并行推进
