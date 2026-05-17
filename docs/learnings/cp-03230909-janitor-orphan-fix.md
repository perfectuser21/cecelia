# Learning: Janitor 孤儿进程精准识别修复

## 根本原因

Janitor 的 `frequent` 模式只用运行时间（≥ 2小时）来判断是否 kill vitest 进程，
没有检查父进程链。导致两个问题：

1. **误杀合法进程**：有头 Claude session 正在跑的测试也会被 kill
2. **阈值太宽**：2小时 >> 40分钟（机器实际崩溃时间），防护完全失效

真正可靠的判断依据是**祖先进程链**：
- Claude 活着时：vitest → npm → zsh → Claude（PPID≠1）
- Claude 崩了后：vitest → npm → zsh（PPID=1，被 launchd 接管）

## 下次预防

- [ ] 凡是写"kill 进程"的逻辑，必须同时做两个检查：时间阈值 + 父进程链验证
- [ ] 守护进程类 fix 优先检查现有脚本是否已有类似逻辑，避免重复造轮子
- [ ] janitor.sh 这类系统级脚本必须纳入 git 管理，不能只放 ~/bin/
- [ ] 阈值设定要参考"机器实际崩溃时间"，而非拍脑袋的安全系数
