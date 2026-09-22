## Brain {VERSION} — OpenClaw 的 grok 反复 403：登录态在 CLI 每 6 小时轮换，贴进去的静态 token 不会跟着换

- 实证：`openclaw agent --model xai/grok-4.5` 报 `HTTP 403`，而 grok CLI 本身真跑有结果（`auth_mode=oidc`，自动续期）。
- 三件事叠出来的：①OpenClaw 的 **xai 插件不注册任何登录方式**（`models auth login` / `setup-token` 都回 `No provider plugins found`），唯一通路是 `paste-token` 贴**静态** token；②`~/.grok/auth.json` 的 key 是 OIDC JWT，实测**约 6 小时到期**，CLI 自己换新的，贴进 OpenClaw 那份快照不会跟着换；③**凭据是 per-agent 的**，每次 paste 都给该 agent 建私库，没有全局写入口——实证贴给 dev 后 dev 通、infra 仍 403，贴给 infra 后 infra 通、main 仍 403。
- 新增 `scripts/ops/openclaw-xai-token-sync.sh`：读 CLI 登录态 → 快到期先触发一次最小调用让 CLI 续 → 重读 → 逐个 agent 贴。agent 名单取自 `agents.entries` 而非扫目录（实测目录 26 个、配置 23 个，多出的是遗留目录，扫目录会对废目录报假警又漏掉新 agent）。
- 带重试：连续 23 次 openclaw 调用会偶发撞上 state-lifecycle 锁，单独重跑即成功；不重试的话每轮莫名掉一两个 agent，而掉的那个几小时后就 403，排查时看不出是锁竞争。
- 守卫 13 项断言，6 项变异逐个实跑验证被抓。**其中一项返工**：变异「只贴第一个 agent」最初把测试本身跑崩（`$RC` 后紧跟全角冒号，`set -u` 下被当成变量名）——崩溃红≠断言红，已全文件扫掉「变量紧跟非 ASCII」的同款隐患。
