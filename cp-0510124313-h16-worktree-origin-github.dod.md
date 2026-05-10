# DoD: H16 — ensureHarnessWorktree clone 后 origin set-url 到 GitHub

- [ ] [BEHAVIOR] ensureHarnessWorktree clone 后 worktree origin URL = GitHub URL，不是 baseRepo 本地路径
  Test: tests/brain/h16-worktree-origin-github.test.js
- [ ] [BEHAVIOR] git remote get-url 失败时 logFn 警告但不抛
  Test: tests/brain/h16-worktree-origin-github.test.js
- [ ] [ARTIFACT] harness-worktree.js 含 'remote', 'set-url', 'origin' + 'get-url'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-worktree.js','utf8');if(!c.includes(\"'set-url'\"))process.exit(1);if(!c.includes(\"'get-url'\"))process.exit(1)"
- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h16-worktree-origin-github.test.js')"
