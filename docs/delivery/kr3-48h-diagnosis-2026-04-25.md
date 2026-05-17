# KR3 微信小程序 — 48h 阻塞点深度分析 + 加速方案

> 分析时间：2026-04-25
> Brain 派发任务：P1-诊断（KR3 25% → ?）
> 预期目标：48h 内跳到 50%+

---

## 零、TL;DR（结论先行）

| 项 | 结论 |
|---|---|
| PRD 的"25%"数据 | **过期**。来自 2026-04-09 旧分析（`docs/delivery/kr3-miniprogram-acceleration.md`） |
| 真实进度（2026-04-15） | **~70%**（Brain OKR `current_value=70`，代码完成度 97%） |
| 阻塞类别 | **非工程瓶颈**。工程代码 PR#2329/2351/2352/2358/2359 全量合并 |
| 真实阻塞 1 | **WX Pay 商户号申请**（外部阻断，数天审核） |
| 真实阻塞 2 | **云函数手动部署**（CN Mac mini 微信开发者工具，非自动化） |
| 资源决策 | **无需增加工程资源**，无需其他 KR 缓冲 |
| 48h 可达进度 | **80%**（完成云函数部署 + 内测启动；支付功能二期） |

---

## 一、进度真实状态核查

### 1.1 两份文档时间线对照

| 文档 | 日期 | 声明进度 | 来源 |
|---|---|---|---|
| `docs/delivery/kr3-miniprogram-acceleration.md` | 2026-04-09 | 25% | 首次延期分析（被 PRD 引用） |
| `docs/current/kr3-status.md` | 2026-04-15 | 97% 代码 / Brain OKR=70 | post-PR#2359 最新状态 |

PRD 自动生成时引用了 16 天前的旧数据，而 2026-04-10 → 2026-04-15 期间 PR#2329/2351/2352/2358/2359 集中合并，推动代码完成度从 25% 跳到 97%。**"25%"不是当前真相**。

### 1.2 已合并的 KR3 相关 PR

| PR | 内容 | 合并时间 |
|----|------|------|
| cecelia#2329 | `kr3-config-checker.js` + `/api/brain/kr3/check-config` 端点 | 2026-04-13 |
| cecelia#2351 | WX Pay 配置引导脚本 + 管理员 OID 落地 | 2026-04-14 |
| cecelia#2352 | 私钥 PKCS#8 转换 + setup 脚本增强 | 2026-04-14 |
| cecelia#2358 | `kr3-config-checker.js` 本地凭据自动检测 + 修复 env var 名称 | 2026-04-14 |
| cecelia#2359 | `kr3-setup-wx-pay.sh --mark-admin-oid`；DB `kr3_admin_oid_initialized` | 2026-04-15 |
| miniapp#1-#27 | 核心功能全量（首页/AI 聊天/文案/文章库/会员/支付/用户管理/bootstrapAdmin） | 持续合并 |

---

## 二、真实阻塞点（按严重度排序）

### 2.1 P0-A：WX Pay 商户号申请（外部阻断）

- **状态**：`wxPayConfigured: false`（Brain `/api/brain/kr3/check-config`）
- **原因**：微信商户平台账号未开通，缺少 `WX_PAY_MCHID` / `WX_PAY_V3_KEY` / `WX_PAY_SERIAL_NO`
- **已就绪**：私钥 PKCS#8（`~/.credentials/apiclient_key.pem`）、`scripts/kr3-setup-wx-pay.sh`、文档 `zenithjoy-miniapp/docs/wechat-pay-setup.md`
- **阻断时长**：数天（商户平台审核不可控）
- **可否并行**：**可以**。支付功能不 blocking AI 聊天/文案/文章库等核心内测。

### 2.2 P0-B：云函数部署到生产环境（手动操作）

- **状态**：⏳ 待操作
- **原因**：云环境 `zenithjoycloud-8g4ca5pbb5b027e8` 与微信账号绑定，不走腾讯云 API → **必须在 CN Mac mini 微信开发者工具手动上传 9 个云函数**
- **可否自动化**：❌ 不能。Cecelia/Codex 无法替代人工点击"上传云函数"
- **耗时**：Alex 约 1 小时

### 2.3 P1：真机兼容性测试

- **状态**：⏳ 待操作
- **要求**：iOS + Android 各 1 台扫码测试（不依赖支付）
- **耗时**：Alex 约 30 分钟

### 2.4 P2：微信平台信息填写

- **状态**：⏳ 待操作
- **要求**：公众平台设置名称 / 图标 / 分类
- **耗时**：Alex 约 15 分钟

---

## 三、48h 加速方案（预期 70% → 80%+）

### 3.1 并行双轨

| 轨道 | 动作 | 负责 | 耗时 | 产出 |
|---|---|---|---|---|
| A（工程 & 人工，可立即启动） | Alex 在 CN Mac mini 微信开发者工具上传 9 个云函数到生产 | Alex | 1h | 云函数生产就绪 |
| A | Alex 微信平台填写名称/图标/分类 | Alex | 15min | 提交审核前置条件达成 |
| A | Alex 内测 5-10 人真机扫码（AI 聊天/文案/文章库/会员 UI，**不含支付**） | Alex | 2h | 发现真机 bug → Codex 修复 |
| A | Codex 并行修真机 bug + 补充隐私声明/用户服务协议页面 | Codex | 持续 | 可提交体验版 |
| A | 提交微信体验版（不含支付） | Alex | 30min | 进度 → 80% |
| B（外部，平行触发） | Alex 登录微信商户平台提交 MCHID 申请 + 下载 V3_KEY + 证书序列号 | Alex | 30min 提交 + 数天审核 | 支付二期解锁 |

### 3.2 48h 里程碑表

| 时间 | 动作 | 负责 | 完成即进度 |
|---|---|---|---|
| H+0 | 商户号申请提交 | Alex | - |
| H+2 | 云函数 9 个全量上传 | Alex | +5%（75%）|
| H+4 | 内测 5 人扫码 + 真机 bug 清单 | Alex | - |
| H+24 | 真机 bug 全修完 + 体验版上传 | Codex | +3%（78%）|
| H+36 | 隐私声明/用户服务协议页面补齐 | Codex | - |
| H+48 | 提交微信审核（不含支付） | Alex | +5%（**83%**）|

### 3.3 进度回写路径（需 Brain 确认）

当前 Brain OKR `current_value=70` 的计算逻辑是否等于"代码完成度 %"？若是，则 2.1–2.4 完成也不会推进数字，需要更新 `kr3-progress-scheduler.js` 的计分模型：

| 阶段 | 建议权重 |
|---|---|
| 代码完成 + 云函数部署 | 60% |
| 内测 + 真机验证 | 70% |
| 提交审核 | 80% |
| 审核通过 + 正式上线 | 100% |

**行动项**：`packages/brain/src/kr3-progress-scheduler.js` 增加 `deploymentStage` 字段，由 `POST /api/brain/kr3/mark-deployed` 等端点驱动。

---

## 四、资源决策

### 4.1 是否需要临时增加资源

**不需要**。理由：

- 工程瓶颈已不存在（代码 97% 就绪）
- 剩余阻塞是 **外部审核**（商户号，增加人不会加速微信审核）+ **人工操作**（微信开发者工具手动上传，Alex 唯一有权操作的账号）
- 增加 Codex/Claude Code 配额不解决任何当前瓶颈

### 4.2 是否有其他 KR 可缓冲资源

**反向释放**。KR3 不占用工程资源，可释放 Codex 产能到：

- 当前 harness watchdog `liveness_dead` 故障（见 PRD"相关历史 Learning"，连续 3 次任务被杀）
- Brain tick.js Phase D 剩余拆分（PR#2600/2602/2603 已完成 Part 1.2–1.4，后续 Part 2+）

### 4.3 对 Alex 的唯一请求

48h 内抽 **2 小时连续块**（微信开发者工具必须在 CN Mac mini 本地执行）：

1. `bash scripts/kr3-setup-wx-pay.sh --check-only` 确认本地状态
2. 微信开发者工具 → 上传 9 个云函数到 `zenithjoycloud-8g4ca5pbb5b027e8`
3. 提交微信商户平台 MCHID 申请（后台审核，不阻塞）
4. 扫码真机测试核心流程 + 回报 bug

---

## 五、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 商户平台审核拒绝（资质问题）| 中 | 支付上线延期 | 方案独立于支付，不阻塞 83% 目标 |
| 真机发现大量 bug | 低 | 体验版推迟 | PR#2329+#2351-#2359 已覆盖已知 bug；预留 H+24 → H+36 修复窗口 |
| 微信审核拒绝（隐私声明缺失）| 高 | 延迟 3-5 天 | H+36 前补齐隐私/用户服务协议页面 |
| Alex 无法抽出 2 小时连续块 | 中 | 48h 目标落空 | 可拆成 2 × 1h（云函数上传 + 真机测试分两天）|

---

## 六、关键证据来源

- `docs/current/kr3-status.md`（2026-04-15 SSOT）
- `docs/delivery/kr3-miniprogram-acceleration.md`（2026-04-09 旧基线）
- `packages/brain/src/kr3-progress-scheduler.js`（进度计算逻辑）
- `packages/brain/src/kr3-config-checker.js`（配置状态检查器）
- `packages/brain/src/routes/kr3.js`（Brain API 端点）
- `scripts/kr3-setup-wx-pay.sh`（WX Pay 配置引导）
- `scripts/check-miniapp-health.sh`（小程序健康检查）

---

## 七、下一步行动项（供 Brain 执行）

- [ ] 更新 Brain OKR KR3 `current_value` 计分模型（`kr3-progress-scheduler.js`）
- [ ] Brain 调度 Alex 任务：`{type:"manual-op", action:"deploy-cloud-functions", deadline:"H+2"}`
- [ ] Brain 调度 Alex 任务：`{type:"manual-op", action:"apply-wx-mchid", deadline:"H+2"}`
- [ ] 48h 后 Brain 复查：调用 `/api/brain/kr3/check-config` 和 `/api/brain/okr/current`，对比预期 83%
