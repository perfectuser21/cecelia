# Learning — stop-dev-v2 cwd-as-key 原型

分支：cp-0421145313-stop-dev-v2-prototype
日期：2026-04-21
Task：06891480-4524-4552-bf59-5ba93964f6b0

## 背景

Stop Hook（stop.sh + stop-dev.sh）累计 99 个 commit，近 5 周 50+ 次修复，
每次"根治"都暴露新 corner case。根因诊断：多字段所有权匹配（session_id /
tty / owner_session / dev-lock 存在性 / 格式版本 / harness 分叉）组合爆炸。

### 根本原因

把"这个 session 在跑 /dev 吗"的判断绑定在可写可错的 .dev-lock 字段上，
而不是进程事实（cwd）。无头 Claude 进程的 cwd 天然是自己的 worktree，
这是进程层事实，不会"丢失"需要自愈、也不会被别人伪造。

老设计让多个 writer（/dev 主流程、codex runner、外部 launcher、Claude
Agent isolation=worktree）都要对 .dev-lock 格式达成协议——外部 launcher
不写或写错格式 → hook 静默放行 → 无头任务中途退出。

### 下次预防

- [ ] 任何"会话/进程身份"的判断优先用**进程层事实**（cwd、pid、env
      CLAUDE_HOOK_CWD 之类协议自带字段），不要靠工作目录里的元数据文件
- [ ] 同一功能如果 3 次修复还不收敛，按 systematic-debugging Phase 4.5
      停下来**质疑架构**，不要打第 4 个补丁
- [ ] Hook 读状态文件时 fail-closed（格式异常 block + 暴露问题），
      不要 silent skip（silent skip 会把无头任务默默放走）
- [ ] 新 hook 原型先不挂 settings.json，写手工 smoke test + 一周稳定
      观察再切线，不要一次替换

## 下一步（本 PR 合并后）

1. 手工 smoke 一周，观察是否有原型漏掉的场景
2. 写切换脚本（同时运行 stop-dev.sh + stop-dev-v2.sh 做 shadow 对比）
3. 切线：settings.json 指向 stop-dev-v2.sh
4. 删除 stop-dev.sh + .dev-lock 写入代码 + self-heal 相关逻辑
