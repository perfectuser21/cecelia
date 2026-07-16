# 小改动 PrepPRD：dispatch-worker 跨账号 worker 派工脚本 v1

## 改什么
新增 `scripts/dispatch-worker.mjs`（核心逻辑，纯函数可测）+ `scripts/dispatch-worker.test.mjs`（node --test）。
功能：controller 派工胶水层——输入任务书+工作目录，自动完成：
1. **查余量**：并行查本机账号池额度（codex team1/2 via wham/usage；claude account1/2 via oauth/usage；grok 无额度 API 默认可用）
2. **选账号**：按 used_percent 最低者优先，>90% 视为不可用跳过；支持 `--vendor codex|claude|grok|auto` 偏好
3. **吊 worker**（headless，命令模板 07-16 已实测）：
   - codex: `CODEX_HOME=~/.codex-teamX codex exec --cd <dir> --sandbox workspace-write --skip-git-repo-check '<brief>'`
   - claude: `CLAUDE_CONFIG_DIR=~/.claude-accountX /opt/homebrew/bin/claude -p --dangerously-skip-permissions '<brief>'`
   - grok: `~/.grok/bin/grok -p '<brief>' --cwd <dir> --always-approve`
4. **撞墙识别**：grep 输出文本（codex 额度打满 exit=0 但 stdout 有 "out of credits"——07-16 实测），命中 → 标记该账号冷却 → 换下家重试（--max-retries 默认 2）
5. **输出**：stdout 一行 JSON `{vendor, account, ok, attempts, output_file}`；worker 完整输出落 `<dir>/.dispatch-worker-<ts>.log`

## 为什么改
one-session controller 模式（RPA Ability 分段串行开发）的派工基建。三厂商链路 07-16 已实测全通（memory: worker-pool-cross-account-verified），本任务只做胶水层固化。

## 关联上下文
- Brain task: d170b909-cb3e-4e29-a497-d30e6369310f
- 相关历史决策：decisions/match 无冲突；GitHub 无撞车 PR
- 账号事实：team2 Plus 常打满；team3/4/5 在西安（v1 不做远程，只做本机池 team1/2 + claude account2 + grok）

## 影响范围
纯新增，不改任何现有文件。不碰 Brain/harness。CI 仅新增测试文件。

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 额度撞墙识别 | ①exit code ②grep 错误文本 | grep 文本（codex: "out of credits"/"rate limit"；claude: "usage limit"/"429"；大小写不敏感） | 07-16 实测 codex 撞墙 exit=0，exit code 不可靠 | 误判撞墙→白换一次账号（无害）；漏判→worker 假完成，controller 验收环节兜底 |
| 账号可用性 | ①每次实时查 ②缓存 | 每次实时查（8s timeout，查询失败视为不可用） | 派工频率低，实时查成本可忽略 | 查询失败误跳过账号→降级到下家（无害） |

## 验收标准
- [ ] `node --test scripts/dispatch-worker.test.mjs` 全绿（覆盖：选账号排序/撞墙文本识别/账号轮换/全池耗尽报错）
- [ ] 真实冒烟：dispatch 一个 trivial 任务书到 auto 池，返回 JSON ok=true
- [ ] CI 全绿
