# Learning：BYPASS 三层防 AI 滥用

## 背景
v23 序列后用户问"BYPASS 怎么防 AI 滥用"。当前漏洞：
- 单因子触发（仅 env var）→ AI 改 `~/.zshrc` 加 export 即可下次启动绕过
- 仅本地 jsonl 日志 → AI 可 `rm` 销证据
- 无 git lint → committed 文件含 `BYPASS=1` 不被 CI 拦

## 根本原因
v23 设计阶段把 BYPASS 当成"信任 env"的逃生通道，没考虑 AI 攻击模型。env 是**单因子**且**无形**，只要满足条件 hook 就放行，没有任何外部可见性。

## 三层防御设计原则

| 层 | 思路 | 类似工业模式 |
|---|---|---|
| 1 git lint | 阻止持久化 attack vector | linter / pre-commit hook |
| 2 Brain alert | 触发即可见 | k8s liveness alarm / IDS log |
| 3 双因子触发 | 把"信任 env"换成"信任 env + 文件" | 银行 2FA |

**层 3 是最强**：把 BYPASS 从无形 env 变成有形文件 + env 双重凭证。AI 改 ~/.zshrc 不再够，还得 `touch .cecelia/.bypass-active`，留 git untracked 痕迹。配合层 2 alert，AI 难悄悄滥用。

## 下次预防

### 下次预防

- [x] BYPASS 双因子触发（env + marker mtime<30min）—— V11 invariant
- [x] check-bypass-not-committed.sh + CI lint job —— layer 1 阻止 committed 设置
- [x] fire_bypass_alert async 推 Brain P0 —— layer 2 用户即时知情
- [x] 4 case 双因子单元测试 + 2 case lint integration test
- [ ] **任何"信任 env"机制都该想想 AI 攻击面**：env 在 AI 工具箱可触达 vs 文件系统留痕迹
- [ ] **可观测性是反作弊的基线**：触发 → alert → 用户看到，比任何代码防御都重要
- [ ] regex grep 正则要严格区分"shell 赋值" vs "字符串引用"，否则误报（feature-registry / 错误消息中的 env 名提及）

## 设计决策记录

**为什么不让 BYPASS 完全消失**：
- 真实场景需要逃生（hook 自身崩溃 / 误 block）
- 完全消失等于把守门变成砖墙
- 双因子是"提高门槛 + 高可见性"，不是"完全禁止"

**为什么 marker 用 mtime 30min 过期**：
- 一次调试通常 < 30min
- 用户忘记 rm marker → 30min 后自动失效
- AI 即使触发也只有 30min 窗口，配合 alert 用户能赶到

**为什么 alert 即使 marker 无效也 fire**：
- AI 试图设 env 但漏 touch marker = 攻击企图，更要让用户知道
- 误报代价低（一条飞书消息），漏报代价高（绕过守门）

## 全 stop hook 系列总览

| PR | 主题 | 价值 |
|---|---|---|
| #2823 | v23 PR-1 基础设施 | guardian + abort + log |
| #2826 | v23 PR-2 心跳模型核心切换 | 209→79 行，决策事实化 |
| #2827 | v23 PR-2.5 单一出口重构 | 8 exit → 1 |
| #2828 | v23 PR-3 v22 cleanup + FD 201 leak 修 | 历史清理 + 真 bug 修 |
| **本 PR** | BYPASS 三层防 AI 滥用 | anti-cheat 加固 |

stop hook 从"22 版崩溃史"到"心跳事实化 + 单一出口纪律 + 三层 anti-abuse 防御"，5 个 PR 一晚完成。
