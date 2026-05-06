# PRD — feat(brain): API credentials checker（Anthropic / OpenAI 健康巡检 thin feature）

## 背景 / 问题

现有 `credentials-health-scheduler.js` 巡检 4 类凭据（NotebookLM / Claude OAuth / Codex / 发布器 cookies），**漏了**：
- Anthropic API 直连（凭据：ANTHROPIC_API_KEY，状态：余额可能 0）
- OpenAI（凭据：OPENAI_API_KEY，状态：quota 可能超额）

实测：本机 ANTHROPIC_API_KEY 余额 0、OPENAI_API_KEY quota 超 — 但**没有任何凭据巡检发现这两个失效**。结果 mouth 调用 fallback 到 anthropic-api 直连永远 400，embedding-service 永远 429，brain-error.log 持续刷错。

## 成功标准

- **SC-001**: 新 module `api-credentials-checker.js` 提供 `checkAnthropicApi()` / `checkOpenAI()` / `checkAllApiCredentials()` export
- **SC-002**: 各 checker 通过最小 API 调用探测健康（messages / embeddings endpoint），区分 5 种状态：ok / no_key / unauthorized / credit_balance_too_low / quota_exceeded / network_error
- **SC-003**: fetch 可注入（测试 mock）+ apiKey 可注入（测试不依赖环境变量）
- **SC-004**: 单元测试覆盖 12 个 case 含所有错误路径

## 范围限定

**在范围内**：
- 新 module `api-credentials-checker.js`（独立功能模块）
- 单元测试用 mock fetch 覆盖各错误路径

**不在范围内**：
- 接入 `credentials-health-scheduler.js` daily cron（下个 PR 接入，本 PR 只提供检查能力）
- alert 集成（caller 拿到 unhealthy_providers 后自己决定 alert）
- working_memory 写入历史（属于运维监控加厚）
- 修复凭据本身（运维操作，不在代码层）

## DoD（验收）

- [x] [ARTIFACT] `packages/brain/src/api-credentials-checker.js` 创建，含 3 个 export function
- [x] [ARTIFACT] `packages/brain/src/__tests__/api-credentials-checker.test.js` 创建
- [x] [BEHAVIOR] tests/api-credentials-checker: 12 个 it（5 个 anthropic + 4 个 openai + 3 个 checkAll）覆盖 200/400/401/429/network_error/no_key

## 受影响文件

- `packages/brain/src/api-credentials-checker.js`（新建）
- `packages/brain/src/__tests__/api-credentials-checker.test.js`（新建）

## Walking Skeleton 上下文

属于 **MJ4 Cecelia 自主神经闭环** 的"凭据健康"加厚段。0→thin。

**thin 范围**：只检测两个 API provider 健康，独立 module 不接调度。
**未来 thin→medium**：接入 daily scheduler + alert 路由 + Dashboard 可见性
**thin→thick**：自动 disable 失效 provider（profile 动态更新）+ retry policy

## 部署后验证

merge + Brain 启动后：
1. 单测在 brain-unit job 全过
2. 后续 PR 接入 scheduler 时直接 import 此 module 调用即可
3. 现阶段不会自动跑（caller-driven），不影响现有行为
