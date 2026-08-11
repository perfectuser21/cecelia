# Learning — 派发前只读凭据新鲜度闸

**任务**: 50389152 / run ecb86354 — 凭据新鲜度前置闸：token 过期时退避等待而非空烧 attempt
**日期**: 2026-08-10

## 现象

2026-08-10 13:14~13:28 三条 harness run 同时判死（`callback_runner_failure`）。每个 attempt
的 provider 会话 384ms 即退、零 token 消耗：

    {"is_error":true,"result":"Not logged in · Please run /login","duration_ms":384,
     "usage":{"input_tokens":0,"output_tokens":0}}

## 根因

`~/.claude-account{1,2}/.credentials.json` 的 OAuth access token 已过期（直到 15:35 才刷新，
中间 2h+ 空窗）。kernel 在派发前没有对目标 account 的本地凭据做新鲜度校验，照常 spawn，
provider 一进程就因未登录退出——白烧 attempt 配额并把 run 推向 caps 终局。

## 修法

在 capability gate 候选选择环节、**provider-auth 网络探针之前**插入一道**纯只读**凭据新鲜度闸
（`preflight/credential-freshness.js`）：读 `claudeAiOauth.expiresAt`，剩余 < 阈值（默认 10min，
`HARNESS_CREDENTIAL_FRESHNESS_THRESHOLD_MS` 可覆盖）或文件缺失/非法/缺 oauth → 跳过该 account，
落到既有 `blockedResult`（`infrastructure_blocked` / `should_create_attempt=false`）+ `emitAlert`。
这复用了 `node_not_base_admitted` 同一条 infrastructure backoff 语义：不消耗 attempt、按
`POLL_INTERVAL_MS` 退避、由 deadline 收敛；凭据恢复新鲜后 run 自行继续，无需人工重派。

## 关键约束（血的边界）

- **纯只读**：只 `readFileSync`，绝不写/重命名/触发刷新。token 刷新由 infrastructure 的
  `refresh-claude-tokens.sh` 独占（决策 4ce29c14：refresh_token 一次性轮换，两个无协调刷新者
  会互相覆盖导致账号永久 `invalid_grant`）。本闸若顺手"帮忙刷新"= 重新引入该竞态。
- **只管 Claude OAuth 凭据**：其它 provider（codex/grok）无 `claudeAiOauth`，`resolveCredentialPath`
  返回 null → 跳过，避免误伤。
- **零回归**：gate 未注入 `checkCredentialFreshness` 时完全 no-op；既有 dispatcher/run 测试
  自带 preflightGate mock，不触发本闸。

## 可迁移经验

派发前的"廉价本地前置校验"应放在昂贵网络探针之前——凭据是本地文件，一次 `stat+read` 就能
挡掉一整轮注定 384ms 空转的 provider 启动。凡是"注定失败且零产出"的派发，都值得在闸门左移。
