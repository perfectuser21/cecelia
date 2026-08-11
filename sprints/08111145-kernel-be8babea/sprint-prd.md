# Sprint PRD — 修复 Cecelia Dashboard 生产入口分叉

## OKR 对齐

- **对应 KR**：未提供可用 KR（Brain context 未返回活跃 OKR）
- **当前进度**：待定
- **本次推进预期**：恢复 Dashboard 官方发布主链的 HK/US 一致性与 Safari 深链稳定性

## 背景

Safari 18.1.1 通过生产入口打开 `/workbench/tasks` 时先命中 HK `100.86.118.99:5211`；HK 独立托管的旧 PWA 与 US `100.71.151.105:5211` 新产物分叉，导致 private context 深链自动回主页。`scripts/deploy.sh --dashboard-only` 必须把 HK 与 US 作为同一发布结果验收，不能只更新 US 后静默成功。

## Golden Path（核心场景）

用户从 Cecelia Dashboard 生产入口 `/workbench/tasks` → 官方 Dashboard 发布主链同步 HK/US 产物并核对指纹 → Safari private 深链保持在 `/workbench/tasks`。

具体：
1. 发布者从官方入口执行 Dashboard-only 发布；发布前的 failing CI 回归证明“US 已更新、HK 仍旧”必须失败。
2. 发布完成后，HK 与 US 的 `build-info`、`index`、`sw.js` 和 deep route 返回同一版本语义，任一节点不同步则发布非零退出，不得静默成功。
3. 独立 evaluator 核对真实 PR head，并从全新 Playwright WebKit context 直达 HK `/workbench/tasks`；等待并刷新后 pathname 仍为 `/workbench/tasks`。
4. 真实生产入口日志中的 Referer 保持 `/workbench/tasks`，作为用户流最终证据；随后由独立 judge 裁决。

## 边界情况

- HK 同步或指纹核对失败时，整次 Dashboard-only 发布失败并产生可观测错误。
- `build-info`、HTML 资产引用、service worker 状态或 deep route 任一项分叉均不得判成功。
- evaluator 无法真实访问 HK/US，或未运行 WebKit 新 context 时必须 FAIL。
- 刷新、等待和 private context 不得触发旧 PWA 注册或根路径重定向。

## 范围限定

**在范围内**：先新增永久 CI 回归；修复 `scripts/deploy.sh --dashboard-only` 官方发布主链；复用现有 HK rsync 与部署指纹能力；真实核对 HK/US 和 WebKit 深链；核对真实入口日志 Referer。

**不在范围内**：不改 DNS、Tailscale、证书；不新建第三份前端；不以只更新 US 代替双节点发布；不改变 Dashboard 产品功能。

## 假设

- [ASSUMPTION: `perfect21:5211` 继续路由到 HK，HK 继续本地托管静态文件并仅代理 `/api` 到 US。]
- [ASSUMPTION: evaluator 所在 macOS 机器具备到两个 Tailscale IP 的网络权限，并可运行 Playwright WebKit。]
- [ASSUMPTION: step_id 未由 PrepPRD 或 task payload 锚定，因此记为 none。]

## 预期受影响文件

- `scripts/deploy.sh`: Dashboard-only 官方发布行为需覆盖并验收 HK/US 一致性。
- `scripts/promote-dashboard.sh`: 现有 HK rsync 发布能力的受控复用或契约对齐。
- `scripts/check-deploy-fingerprint.sh`: 双节点真实产物指纹与失败语义验收。
- `packages/quality/`: 新增先红后绿、永久保留的 Dashboard 发布主链 CI 回归测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 等待与刷新必须覆盖 Safari private 深链稳定性，具体上限待 proposer 在可执行合同中明确
- 频控: 不适用
- 版本要求: Safari 18.1.1；Playwright WebKit；真实 PR head
- 可观测: 发布失败必须非零退出；真实入口日志必须能确认 Referer 为 `/workbench/tasks`

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为本 sprint 适用的 area 铁律 -->
- [真环境验证] 依赖生产环境的接缝断言必须在真实目标验证，未真验不得标 done（来源: area）
- [环境不写死] 环境假设值须从目标环境推导或真机校准（来源: area）
- [部署失败] 部署链任何失败路径禁止 warning 降级，必须可观测并非零退出（来源: area）
- [生产自报] 判变基准使用生产实体的 build-info/health 自报值，禁止用工作区 diff 代替（来源: area）
- [语义一致] 判变端与终验端对版本和未知值必须采用同一处理语义（来源: area）
- [验证命令] 合同中的验证命令批准前必须实跑并确认真实 exit code（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私与 PII 不得明文进入日志（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 mac_web 填入真实的 HK/US curl 对账、部署/PWA 测试、Playwright WebKit 新 context 与生产入口日志核验命令。
# 期望验收点：真实 PR head 的发布使 HK/US build-info、index、sw.js、deep route 一致；WebKit 从 HK 直达 /workbench/tasks，等待和刷新后 pathname 不变；Referer 保持 /workbench/tasks。
# 强制失败条件：任一真实节点不可达、未执行 WebKit、双节点指纹不一致、深链跳回主页或缺少真实入口日志证据。
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard 的 Safari/WebKit 用户可见深链行为，按 UI 优先级判定为 user_facing。
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard Web UI 由 us-mac-m4 上的 Playwright WebKit 验证，并真实访问 HK/US 生产节点。
## journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6
## step_id: none（PrepPRD 未锚定）
