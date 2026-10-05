# Learning：多账号概念散落在启动器、桥接、台账、compose 与脚本里，删目录前必须先盘全引用

### 根本原因
- 「Claude 账号目录」没有单一真身：`~/.claude-accountN` 同时被启动器（账号切换 + resume 软链）、bridge（accountId 拼目录）、台账采集器（credential_path）、compose 挂载、本机脚本（scan-skills / dispatch-worker / memory-sync）各自写死，删一个目录会让这些地方各自静默失效。
- 同一账号在 `~/.claude` 与 `.claude-account1` 各持一条独立 OAuth 链，会互相踢登录；resume 软链还经账号目录绕一圈再回 `~/.claude/projects`，造成 `/resume` 列表膨胀到 650+ 条软链、近 50 条悬空。
- `superpowers` 插件当初只装在账号目录里，合并到单目录后 `~/.claude` 里没有缓存，/dev 接力链的 `superpowers:*` 技能不可用，要显式安装。

### 下次预防
- [ ] 删除或合并配置目录前，先 grep 全仓 + `~/bin` + LaunchAgents + compose 的全部引用，按「会不会静默失效」分类处理，不要只改最显眼的一处。
- [ ] 台账/DB 里的账号 id 与「目录名」解耦：id 是数据连续性的键，目录路径是可变配置，二者不要用同一套字符串拼接规则。
- [ ] 合并单账号后立刻核对插件（superpowers 等）是否装在目标目录，并用一次真实 `claude -p` 验证登录与技能可用。
