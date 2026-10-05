## Brain {VERSION} — 仓库侧去多账号化：Claude 只保留单账号单目录 ~/.claude

- 主理人拍板只保留一个 Claude 账号（决策 7952bd84），本机 `.claude-account1/2/3` 目录已删除；仓库里仍把它们当默认值的地方一并改指 `~/.claude`，否则删除后会静默失效。
- `ops-model-accounts-collector.js`：`claude-account1` 台账条目的 `credential_path` 改为 `~/.claude/.credentials.json`（条目 id 不变，保 DB/Notion 连续；`claude-account2` 条目保留以维持「恰好 8 条」口径，后续另议）。
- `cecelia-bridge.cjs`：`accountId` 废弃，`claude -p` 一律走默认 `~/.claude`。`skill-eval-worker.js` / `commander-invoker.js` / `memory-sync.js`：默认目录与候选目录改 `~/.claude`。
- `docker-compose.yml` / `docker-compose.staging.yml`：删除 `.claude-account1~3` 挂载。
- `scripts/claude-launch.sh`：删除账号切换（`.active-account-dir`）与 per-session projects 软链/sweep 子系统，保留 per-session worktree 与孤儿自愈；`scripts/dispatch-worker.mjs`：Claude 单账号即 controller 主线，不入 worker 池。
- 未动（另立任务）：`provider-account-home.js` 的 `.claude-accountN` 目录映射与 dispatcher 账号选择——影响其他执行机，需逐机核对后再改；`routes/harness.js` 读 `~/.claude-account1/skills`（该目录此前就不存在，静默返回 null）。
- 回归：`packages/engine/tests/launcher/claude-launch.test.ts` 以单账号契约替换旧账号切换/软链/sweep 三组用例；`scripts/dispatch-worker.test.mjs`、`ops-model-accounts-collector.test.js` 同步更新（任务 702f6a1b）。
