# TASK CARD: KR3 小程序支付商户号配置 + 管理员 OpenID 标记

## 任务信息
- **Task ID**: e1c64e7f-b339-44d7-a591-fa0912d0a915
- **Branch**: cp-0414220023-e1c64e7f-b339-44d7-a591-fa0912
- **优先级**: P1
- **类型**: dev

## 目标

完成上线 checklist 最后两个待办项：

1. **管理员 OpenID 标记**
   - 内置 OpenID `o2lLz62X0iyQEYcpnS2ljUvXlHF0` 已在 `checkAdmin` 三层 fallback 中
   - `kr3-setup-wx-pay.sh` 缺少 `--mark-admin-oid` 选项
   - 需写入 Brain DB `kr3_admin_oid_initialized` decision 标记

2. **支付商户号配置工具完善**
   - WX_PAY_MCHID / V3_KEY / SERIAL_NO 凭据尚未填入（需与支付团队协调）
   - 私钥已就绪（`~/.credentials/apiclient_key.pem`）
   - 增强脚本引导流程，确保配置后能一键标记 Brain DB

## 工作范围

| 工作 | 仓库 | 说明 |
|------|------|------|
| `--mark-admin-oid` 选项 | cecelia | kr3-setup-wx-pay.sh 新增 |
| Brain DB admin OID 标记 | cecelia | POST /api/brain/kr3/mark-admin-oid |
| launch-checklist.md 更新 | zenithjoy-miniapp | 管理员 OID 状态更新为功能就绪 |

## 背景

- 前序 PR #0413031113 已完成：notifyPayment + checkAdmin 三层 fallback + notify_url 修复
- 当前阻断：`kr3_admin_oid_initialized` 未写入 Brain DB（脚本缺失此功能）
- WX_PAY 商户凭据空缺属于运营任务，当前 PR 范围内提供工具支持
