# dispatch-worker 跨账号 worker 派工脚本 — 设计

日期：2026-07-16 ｜ Brain task: d170b909 ｜ PrepPRD: sprints/07162251-dispatch-worker/prep-prd.md

## 目标
one-session controller 模式的派工胶水层：输入任务书+工作目录，自动选账号→吊 headless worker→额度撞墙自动换账号重试→返回结构化结果。三厂商命令链路 07-16 已实测（memory: worker-pool-cross-account-verified）。

## 架构
单文件 `scripts/dispatch-worker.mjs`（ESM，`#!/usr/bin/env node`，遵循 scripts/ 惯例），纯函数 export 供测试 + CLI 入口。**自包含，不 import brain 模块**——派工脚本要在任意交互 session 独立可用；但阈值/排序语义与 brain `codex-account-usage.cjs` 对齐（used_percent 升序、≥90% 不可用）。

## 组件（纯函数，全部 export）
1. `ACCOUNT_POOL`：本机账号静态清单——codex team1/team2（CODEX_HOME）、claude account2（CLAUDE_CONFIG_DIR，account1 是 controller 主线默认不下场）、grok。每项含 vendor/name/credPath/queryKind。
2. `pickAccounts(accounts, {vendor})`：过滤 usable（used_percent < 90 且查询成功）→ 按 used_percent 升序 → 返回排好序的候选队列（不只返回一个，供轮换）。
3. `detectQuotaWall(text)`：大小写不敏感匹配 `out of credits` / `rate limit` / `usage limit` / `429` / `quota`。**不信 exit code**（07-16 实测 codex 撞墙 exit=0）。
4. `buildCommand(vendor, account, brief, dir)`：返回 {cmd, args, env}——三厂商实测模板：
   - codex: `codex exec --cd <dir> --sandbox workspace-write --skip-git-repo-check <brief>`，env CODEX_HOME
   - claude: `/opt/homebrew/bin/claude -p --dangerously-skip-permissions <brief>`，env CLAUDE_CONFIG_DIR，cwd=dir（绝不用裸 claude，alias 劫持）
   - grok: `~/.grok/bin/grok -p <brief> --cwd <dir> --always-approve`
5. `queryUsage(account)`：fetch wham/usage（codex）/ oauth/usage（claude），8s timeout，失败→视为不可用；grok 无额度 API→恒可用（垫底候选）。
6. CLI 主流程：解析 `--brief <文件或字符串> --dir <workdir> [--vendor auto|codex|claude|grok] [--max-retries 2]` → 查余量 → 候选队列逐个尝试：spawn（继承实时输出到 log 文件）→ 完成后 detectQuotaWall(全量输出) → 撞墙则下一候选 → 成功或池耗尽。

## 输出契约
- stdout 最后一行 JSON：`{"ok":bool,"vendor":str,"account":str,"attempts":[{account,quota_wall}],"output_file":str,"exit_code":int}`
- worker 全量输出落 `<dir>/.dispatch-worker-<ts>.log`
- 池耗尽/brief 缺失 → ok:false + 非零退出码

## 错误路径
| 场景 | 行为 |
|---|---|
| 某账号 usage 查询超时/失败 | 跳过该账号（打日志），不中断 |
| worker 输出命中撞墙文本 | 该账号标记冷却，换下一候选，attempts 记录 |
| 全池耗尽 | ok:false, reason:"pool_exhausted"，退出码 1 |
| brief 文件不存在 / dir 不存在 | 参数校验立即失败，退出码 2 |
| worker 非零退出且非撞墙 | 不换账号（是任务问题不是额度问题），ok:false 原样返回 |

## 测试策略
- **unit（node --test，scripts/dispatch-worker.test.mjs）**：pickAccounts 排序/过滤/vendor 偏好、detectQuotaWall 命中与不命中样本（含 07-16 实测 codex 错误原文）、buildCommand 三厂商快照、轮换逻辑（mock spawn 注入撞墙输出→断言换账号）、池耗尽路径。
- **integration/E2E**：真实派工冒烟（trivial brief → auto 池 → 断言 JSON ok:true）——手动/merge 前跑一次，不进 CI（CI 无账号凭据）。
- **CI 接线（必做，防假绿）**：ci.yml 新增 step `node --test scripts/dispatch-worker.test.mjs`（setup-node 20），仿 test-pyramid-guard job。

## 不做（v1）
西安远程账号（team3/4/5 需 ssh 包装）、账号冷却持久化（进程内即可）、并行派工、接进 harness/Brain。
