## Brain {VERSION} — grok token 同步器在 launchd 下续期恒失败：`grok` 不在它声明的 PATH 里

- 生产打脸：`grok` 装在 `~/.grok/bin/grok`，而同步器把 PATH 声明成 `/opt/homebrew/bin:/usr/local/bin`。launchd 下续期那步恒报 `timeout: failed to run command 'grok': No such file or directory`，日志只显示「续期调用失败 —— CLI 可能需要重新登录」，**把一个 PATH 问题误导成人工活**。
- 同一天 `session-runner-router` 也栽在 launchd PATH 上（plist 没设 PATH → `timeout` 找不到 → 探活恒假 → 那个路由器从装上起一次都没成功过）。**同一类：自动化脚本在 launchd 下的 PATH 和人的 shell 不是一回事，必须显式声明全。**
- 守卫加一条：在「脚本声明的 PATH + launchd 默认 PATH」的组合里必须找得到 `grok`。写这条断言时我自己连栽三次——变量没展开、`command -v` 是内建 env 跑不了、底座 PATH 连 `sh` 都没有，**测的一度不是要测的东西**。
