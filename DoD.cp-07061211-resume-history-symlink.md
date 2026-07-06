# DoD — resume 历史软链回主仓

## ARTIFACT 条目

- [x] [ARTIFACT] `scripts/claude-launch.sh` 含 `_path_to_project_key` 与 `_link_projects_dir` 函数
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('_path_to_project_key')||!c.includes('_link_projects_dir'))process.exit(1)"

- [x] [ARTIFACT] `scripts/claude-launch.sh` 支持 `CLAUDE_PROJECTS_ROOT` 覆盖
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('CLAUDE_PROJECTS_ROOT'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] auto-worktree 启动 → 运行期内 <wt_key> 是指向 <main_key>（物理 key）的软链
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] 孤儿真实目录 → 内容迁入主仓文件夹并原位替换为软链
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] 干净退出 → 软链删除且主仓池子 transcript 完好；脏 worktree 保留 → 软链保留；幂等复用 no-op；错误目标软链被替换
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] 软链失败（只读 root）→ claude 照常启动、退出码透传、stderr 警告（best-effort 铁律）
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] --dry-run（auto-worktree）→ 输出含 ln -s 契约行
  Test: packages/engine/tests/launcher/claude-launch.test.ts
