# PRD: learnings 月度归档 workflow

## 背景

Repo-audit 第 4/第 11 项技术债命中：`docs/learnings/` 累积 **1117 个** md 文件，每次 /dev 追加一份，无任何归档或清理机制。后果：

- 对话 context / Grep 扫描 / tar 打包越来越慢
- 历史 learning 混在当前 learning 里，找有用的要翻
- `docs/` 目录看上去像垃圾堆，传达"我们不收拾"的信号

## 成功标准

1. 新增 `.github/workflows/archive-learnings.yml` workflow
2. 每月 1 号 04:00 UTC 自动跑（cron）
3. 支持 `workflow_dispatch` 手动触发（一次性清理 + 日常调试）
4. 归档逻辑：
   - 扫描 `docs/learnings/*.md`（顶层，不递归到 `archive/`）
   - 用 `git log --follow --diff-filter=A --format=%at -1` 拿每个文件首次入库 commit 的 author time（稳定不随 checkout 重置）
   - 30 天前的文件，按 YYYY-MM 分桶
   - 每桶 `tar -czf docs/learnings/archive/YYYY-MM.tar.gz`
   - `git rm` 原文件
   - bot commit + push 到 main
5. 新增 workflow 单元测试（engine-tests 自动跑）
6. 本 PR 不做一次性大清理（1117 文件会爆 PR size 硬门禁 1500 行）；merge 后手动 dispatch workflow 做初始清理

## 非目标（YAGNI）

- 不归档 30 天内的 learning（活跃期）
- 不做归档文件去重 / 压缩优化
- 不改 Learning 文件本身内容或写入路径
- 不增加"查询归档内容"的脚本（需要时 `tar -tzf archive/2026-02.tar.gz` 够用）
- 不改 `learnings/archive/` 路径结构（YYYY-MM.tar.gz 一个月一个桶）

## 为什么用 git log 时间不用 mtime

CI runner checkout 出来的文件 mtime 全是 checkout 那一刻，不是文件真正的创建时间。用 `git log --follow --diff-filter=A -1` 拿首次入库 commit 的 author time，是稳定的历史事实。

## PR 后手动触发一次性清理

本 PR 只提供 workflow，不做一次性清理（1117 deletions 会爆 PR size 1500 行硬门禁）。合并后：

1. GitHub → Actions → Archive Old Learnings → Run workflow
2. 单次 run 会把全部 30 天前 learning（约 1050+）归档
3. 打开 main 最新 commit 看 `docs/learnings/archive/` 结构
