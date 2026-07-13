# thalamus LLM 链路修复：bridge launchd 禁用 + codex CLI 缺信任检查跳过参数

## 背景

Brain task d36f22a1（"thalamus LLM路径修复"）的原始描述假设 thalamus primary provider
是 `anthropic-api`（直连余额耗尽），要求验证 bridge 可靠性后切回订阅路径。

实测发现该假设已过时：DB 中 `model_profiles.profile-anthropic.thalamus` 自 2026-05-03
起就已经是 `provider=anthropic(bridge)` + `fallbacks=[codex, anthropic-api]`。真正阻断
全链路的是两个独立的 OS/CLI 层故障：

1. `com.cecelia.bridge`（宿主机 3457 端口，`/Library/LaunchDaemons/com.cecelia.bridge.plist`）
   被 launchd 持久标记为 `disabled`（`launchctl print-disabled system` 证实），进程未运行。
   bridge-keepalive 自愈机制（`scripts/ops/bridge-keepalive-check.sh`）用
   `launchctl kickstart gui/${UID}/com.cecelia.bridge` 去救一个跑在 **system domain**
   的 LaunchDaemon，domain 打错，kickstart 永远失败，自愈名存实亡。
2. fallback #1 `codex exec` 因 brain 容器内 cwd 不是 git 仓库，缺
   `--skip-git-repo-check` 参数直接 exit 1（"Not inside a trusted directory"），
   该错误文本被日志截断规则（300 字符）挡在前面无害的 PATH 只读 WARNING 之后，
   误读成"Read-only file system"。

两者叠加：primary（bridge）连不上 → fallback codex 失败 → fallback anthropic-api
（余额 0）失败 → 全部候选耗尽 → 触发 P1 `anthropic_api_balance_low`。

## 修复范围

1. `packages/brain/src/llm-caller.js` `callCodexHeadless()`：
   spawn 参数 `['exec', '-m', actualModel, prompt]` 改为
   `['exec', '--skip-git-repo-check', '-m', actualModel, prompt]`。
2. `scripts/ops/bridge-keepalive-check.sh` `attempt_restart()`：
   `launchctl kickstart "gui/${USER_ID}/${BRIDGE_PLIST_LABEL}"` 改为
   `launchctl kickstart "system/${BRIDGE_PLIST_LABEL}"`（LaunchDaemon 走 system domain，
   不需要也不应该用 USER_ID 拼 gui domain）。

## 不在本次范围

- thalamus primary provider 配置：已经正确，不改。
- `com.cecelia.bridge` 当前被 `disabled` 的持久状态已用 `launchctl enable` 手动止血
  恢复运行；根治（为什么会被标记 disabled）不在本次代码修复范围，记录进 memory
  留待后续排查（同类 launchd-disabled 故障已有第二例，见 memory
  `zenithjoy-api-launchd-outage.md`）。

## 测试策略

- **Unit（新增）**：`packages/brain/src/__tests__/llm-caller-codex-trust-check.test.js`
  - 源码静态断言：`llm-caller.js` 含 `--skip-git-repo-check`
  - 行为测试：mock `child_process.spawn`，断言 `callCodexHeadless` 调用 spawn 时
    参数数组包含 `--skip-git-repo-check`
- **Shell 脚本回归（新增）**：`packages/brain/src/__tests__/bridge-keepalive-domain.test.js`
  - 读取 `scripts/ops/bridge-keepalive-check.sh` 源码，断言含
    `system/${BRIDGE_PLIST_LABEL}`，不含 `gui/${USER_ID}/${BRIDGE_PLIST_LABEL}`
- 两个测试都是 proven-to-fire 守卫：改回旧代码会让测试报红。
