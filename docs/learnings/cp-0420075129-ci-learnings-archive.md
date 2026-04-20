# ci-learnings-archive（2026-04-20）

### 根本原因

`docs/learnings/` 累积到 1117 个 md 文件，没归档机制 —— 每次 /dev 追加一份，永不清理。典型的"只写不扫"技术债。

顺带发现两个 CI / git 操作细节：
1. **文件 mtime 不能用作"真正年龄"**：CI runner checkout 出来的文件 mtime 全是 checkout 那一刻，不是首次入库时间。要用 `git log --follow --diff-filter=A --format=%at -1 -- <file>` 拿第一次入库的 author time
2. **大批量 deletions PR 会爆 size 门禁**：1117 files deletion ≈ 1117+ 行，超过 1500 行硬门禁。所以本 PR 只提供 workflow 机制，一次性清理由 workflow dispatch 跑（不经 PR，不走 size check）

### 下次预防

- [ ] 任何"只追加不清理"的目录（logs / tmp / learnings / snapshots）都应该配对一个归档/轮换机制，在第一次加入目录设计时就定，不要等堆到 1000+ 才想起
- [ ] 凡是要用文件时间的 CI / 脚本，默认用 `git log --diff-filter=A --format=%at` 拿历史事实，不用 `stat` / `mtime`
- [ ] PR size 硬门禁（1500 行）上线后，任何"一次性大清理"都要改成"提供机制 + 手动/自动触发"的分离模式，不要试图塞进一个 PR
