# 西安 M4 Codex 远程派发 Full access 设计

## 背景

美国 M4（aad17）是 Codex token 的唯一持久化和刷新端。`scripts/codex-remote-launch.sh` 从美国侧把选定账号的 `auth.json` 推送到西安 M4，然后通过 SSH 创建远程 tmux/Codex session。西安侧不执行 `codex login`，也不接收美国侧整份 `config.toml`。

当前远程 launcher 只设置 `CODEX_HOME` 后直接执行 Codex，因此 session 的权限取决于西安侧该账号目录中的本地配置。目标是让这个美国主动派发入口创建的每个西安 Codex session 都显式使用 Full access，并且不依赖西安已有权限配置。

## 方案

在带 brief 和不带 brief 的两条远程 launcher 命令中，将 Codex 启动方式改为：

```bash
codex --dangerously-bypass-approvals-and-sandbox [PROMPT]
```

该命令行参数直接作用于本次 session，优先级高于本地默认配置。带 brief 时，flag 必须位于由远程文件展开的 prompt 位置参数之前。

不选择以下方案：

- 不通过 SSH 修改西安 `config.toml`，避免引入每账号持久状态和配置漂移。
- 不从美国复制整份 `config.toml`，避免携带美国主机路径、插件、MCP 或其他主机专属配置。
- 不修改 `scripts/codex-request.sh`；它是西安人工发起、从美国只读借用 token 的另一条通道。

## 数据流与边界

1. 美国侧验证账号白名单与本地 `auth.json`。
2. 美国侧保持现有流程，仅推送 `auth.json` 并在西安设置权限为 600。
3. 美国侧上传可选 brief，写入远程临时 launcher。
4. 远程 launcher 设置 `PATH` 和对应账号的 `CODEX_HOME`。
5. 远程 launcher 以 `--dangerously-bypass-approvals-and-sandbox` 启动 Codex。
6. tmux session 的创建、列举与 token collect 流程保持不变。

## 风险与安全边界

该 flag 会让 Codex 对西安宿主机真正无沙箱运行，并跳过常规批准。这是用户明确要求的行为。它不改变 SSH 身份、Unix 文件权限或账号 token 权限，也不保证跳过独立的 hook trust 控制。

改动限定在 `codex-remote-launch.sh` 创建的 session，不扩展到其他 dispatcher、runner 或西安人工 pull 通道。

## 测试策略

测试档位：unit/integration shell 测试。

- 在现有 mock SSH 测试中，分别运行带 brief和不带 brief 的真实 launcher 分支。
- 断言 mock SSH 捕获到的远程 launcher 内容包含 `--dangerously-bypass-approvals-and-sandbox`。
- 带 brief 分支额外断言 flag 位于 `$(cat remote-brief-path)` prompt 之前。
- 先新增断言并确认测试因缺少 flag 失败，再实施两条最小命令修改。
- 验收运行 `bash -n scripts/codex-remote-launch.sh` 与 `bash scripts/__tests__/codex-remote-launch.test.sh`。

## 成功标准

- 带 brief 与不带 brief 的远程 session 都显式携带 bypass flag。
- 测试验证生成的远程命令，而不是只搜索生产脚本源码。
- 账号白名单、token 推送、权限 600 和 collect 行为保持不变。
- 不依赖或复制西安 `config.toml`。

## 不做

- 不修改 `scripts/codex-request.sh`。
- 不修改 `auth.json` 同步、刷新、回收或登录逻辑。
- 不修改其他 Codex runner/dispatcher。
- 不新增远端配置同步机制。
