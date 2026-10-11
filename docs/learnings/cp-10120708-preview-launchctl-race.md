## 预览主机发布被 launchctl bootout 异步卸载坑到回滚（2026-10-12）

### 根本原因
- `launchctl bootout gui/$UID/<label>` 返回时服务可能还在卸载中，脚本紧接着 `launchctl bootstrap` 会得到 `Bootstrap failed: 5: Input/output error`。
- preview-host-release.sh 的 reload_agent 与 preview-agent-install.sh 都是"bootout 后立刻 bootstrap"，发布在 MMV 实测因此整次回滚；回滚时的重载因中间隔了时间反而成功，掩盖了根因。
- 测试里的 launchctl mock 无状态、一律 exit 0，从结构上测不出这种时序问题。

### 修复
- 抽出 scripts/lib/launchd-reload.sh（两脚本共用）：bootout → 轮询 `launchctl print` 直到服务消失（≤15s）→ bootstrap 失败则 sleep、再 bootout+等卸载后重试（共 3 次）→ kickstart -k。
- 测试 mock 改为有状态：bootout 后 print 仍可见数次、服务未卸干净时 bootstrap 返回 5，可强制首次 bootstrap 失败。

### 下次预防
- [ ] 调 launchctl/systemctl 这类异步控制面时，"命令返回"≠"状态已到位"：卸载后先轮询确认消失再装载，装载要带有限重试
- [ ] 外部命令的 mock 要复刻真实时序与失败码（有状态），一律 exit 0 的 mock 只能测到快乐路径
