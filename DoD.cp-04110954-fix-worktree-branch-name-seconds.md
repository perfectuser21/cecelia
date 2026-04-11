# DoD: fix-worktree-branch-name-seconds

**Task**: 8f5450bc-82e5-470e-9c9b-1926c4b0d976
**Branch**: cp-04110954-fix-worktree-branch-name-seconds

## 验收条件

- [x] [ARTIFACT] `packages/engine/skills/dev/scripts/worktree-manage.sh` 第 145 行含 `date +%m%d%H%M%S`（秒精度）
- [x] [BEHAVIOR] worktree-manage.sh 文件内容包含 `%m%d%H%M%S`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('%m%d%H%M%S'))process.exit(1);console.log('OK')"`
- [x] [ARTIFACT] Engine 版本已从 14.5.1 → 14.5.2（5 个文件）
- [x] [ARTIFACT] `packages/engine/feature-registry.yml` 含 version 14.5.2 changelog 条目
