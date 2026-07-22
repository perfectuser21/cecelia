## 西安 Codex 远程 session 权限必须在派发入口显式声明（2026-07-22）

### 根本原因

美国 M4 向西安 M4 派发 Codex session 时只同步 `auth.json`，不会同步美国侧 `config.toml`。因此修改美国主机的默认 permission 只能影响美国本机进程，无法保证西安新 session 获得相同权限。远程启动命令此前也没有显式权限参数，行为会依赖西安侧每个 `CODEX_HOME` 的本地状态。

### 下次预防

- 跨机派发需要固定执行权限时，在创建目标 session 的 launcher 中显式传递权限参数，不依赖来源机配置同步。
- token、主机配置和 session 启动参数分别管理；只同步完成认证所需的 `auth.json`，不要复制整份 `config.toml`。
- 所有远程 launcher 分支都用 mock SSH 行为测试验证最终生成的完整 `exec` 命令，包括动态 prompt 路径和参数顺序。
