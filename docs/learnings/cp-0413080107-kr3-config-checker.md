# Learning — KR3 配置检测模块设计

**分支**: cp-0413080107-98f59188-9b0e-4612-9df2-b76889
**日期**: 2026-04-13

### 根本原因

Brain 对 KR3 小程序上线前置条件（WX_PAY 商户号 + 管理员 OpenID）无感知，SelfDrive 无法自动判断是否可推进下一步。两个阻断项均为外部配置（微信云控制台 env var + bootstrapAdmin 调用），Brain 内部无直接检测手段。

### 解决方案

通过 Brain DB `decisions` 表记录配置就绪标志（`kr3_wx_pay_configured` / `kr3_admin_oid_initialized`），人工完成配置后通过 API 写入，Brain 即可感知。

### 下次预防

- [ ] 外部系统配置项（不在 Brain 进程内）应通过 DB 标志而非环境变量检测
- [ ] 模块级 `import pool` 会导致无 node_modules 环境（DoD `manual:node` 测试）失败 — 应改为函数内懒加载 `(await import('./db.js')).default`
- [ ] DoD `[BEHAVIOR]` 测试在 CI 中无 node_modules，应优先用 `node -e "readFileSync"` 内容检查而非模块导入
