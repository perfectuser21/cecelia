# DoD: harness-worktree 初始化 .git 状态校验

## 验收清单

- [x] [BEHAVIOR] 孤儿 worktree dir（.git 是独立 repo 而非主仓库 clone）被检测并自动 rebuild
  Test: tests/__tests__/harness-worktree-state-validation.test.js

- [x] [BEHAVIOR] 合法 worktree（origin remote 指向 baseRepo）被正确复用，不重建
  Test: tests/__tests__/harness-worktree-state-validation.test.js

- [x] [BEHAVIOR] dir 不存在时走原 clone 路径，新增校验不干扰
  Test: tests/__tests__/harness-worktree-state-validation.test.js

- [x] [ARTIFACT] harness-worktree.js 含 .git 状态校验逻辑（remote URL / orphan 关键字）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!/orphan|isOrphan|validate.*git|remote.*get-url/i.test(c))process.exit(1)"

- [x] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-worktree-state-validation.test.js')"

## Learning

文件：docs/learnings/cp-05071846-harness-worktree-git-validate.md

## 测试命令

```bash
cd packages/brain && npx vitest run src/__tests__/harness-worktree-state-validation.test.js
```
