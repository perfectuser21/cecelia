# Task Card: KR3 状态文档更新 + WX Pay 外部阻断标记

**Branch**: cp-0414224938-e1c64e7f-b339-44d7-a591-fa0912  
**Task ID**: e1c64e7f-b339-44d7-a591-fa0912d0a915  
**KR**: ZenithJoy KR3 — 微信小程序上线

---

## 背景

KR3 checklist 最后两个待办项：
1. **管理员 OpenID**：已完成（adminOidReady: true）。checkAdmin 三层 fallback 就绪，Brain DB 中 `kr3_admin_oid_initialized` decision 已标记。
2. **支付商户号配置**：外部阻断。私钥 PKCS#8 已就绪，但 MCHID/V3_KEY/SERIAL_NO 需要从微信商户平台申请（未开展）。

`docs/current/kr3-status.md` 停留在 post-PR#2329，未反映 PR#2351-#2359 的全部进展。

## 本次交付

1. 更新 `docs/current/kr3-status.md`：反映 PR#2351-#2359 全量合并状态
2. 明确标记 WX Pay 为"外部阻断"（待商户号申请），防止 Brain 无限重派 dev 任务

## 技术方向

- `docs/current/kr3-status.md`：状态表更新至 PR#2359，P0 阻断项明确区分"外部阻断"vs"待操作"
- 不改业务代码（管道工具已由 PR#2351-#2359 完整交付）
