# cp-0420175955-phase76-launcher-bypass-alias — Learning

### 背景

Phase 7.1 建的 claude-launch.sh 用 `exec claude` 在 bash 子进程里执行真 claude。用户加 `alias claude='bash ...claude-launch.sh'` 到 zshrc 重启 claude 后报 **permission denied**。

### 根本原因

Claude Code 的 shell-snapshots（`~/.claude-accountX/shell-snapshots/*.sh`）给每个 shell 注入了一个 `claude` shell function（`type -a claude` 能看到）。launcher 在 bash 子进程里 `exec claude ...`：
- bash 本身不继承 zsh alias，但 Claude Code 的 shell-snapshot 会被 bash 加载（因为 `BASH_ENV` 或类似机制）
- 结果 bash 子进程里 `claude` 也被解析成 shell function → 调回 launcher 自己 → **无限递归/权限混乱 → "permission denied"**

Phase 7.1 没测到这个因为我本地测试是用 `bash /path/to/launcher.sh` 直接跑，没经过 zsh alias → bash → exec claude 的完整链路。

### 下次预防

- [ ] 任何 launcher 脚本避免用 unqualified `exec <cmd>`：要么绝对路径 (`exec /opt/homebrew/bin/claude`)，要么用 `env -i` 清环境，要么先 `unset -f cmd; unalias cmd 2>/dev/null` 清干净
- [ ] 写 wrapper/launcher 时必须用**最终用户链路**测（zsh → alias → bash → exec real binary），不能只跑 `bash launcher.sh` 这种局部测试
- [ ] Claude Code 的 shell-snapshots 会污染 bash 子进程 env；未来写任何 cecelia 脚本涉及 `claude` 子命令时，先 `type -a claude` 看链路
- [ ] launcher 类脚本必须有 "找不到真 binary" 的明确错误信息（本修里加了 exit 127 + stderr 提示），不要闷头 exec 失败
