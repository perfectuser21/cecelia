# DoD: Tier 1 加固 — worktree race + 4 lint 长牙 + zombie-cleaner 兼容

- [x] [BEHAVIOR] cleanup-lock.js 8 个单测全绿
  Test: packages/brain/src/utils/__tests__/cleanup-lock.test.js

- [x] [ARTIFACT] cleanup-lock.sh chmod +x 且含 acquire_cleanup_lock + release_cleanup_lock
  Test: manual:node -e "const fs=require('fs');const p='packages/brain/scripts/cleanup-lock.sh';fs.accessSync(p);const c=fs.readFileSync(p,'utf8');if(!c.includes('acquire_cleanup_lock()')||!c.includes('release_cleanup_lock()'))process.exit(1);if(!(fs.statSync(p).mode&0o111))process.exit(1)"

- [x] [BEHAVIOR] cleanup-lock.sh smoke：acquire → release → 文件不存在
  Test: manual:bash -c "export CLEANUP_LOCK_DIR=/tmp/cecelia-test-dod.lock; rmdir \$CLEANUP_LOCK_DIR 2>/dev/null; source packages/brain/scripts/cleanup-lock.sh && acquire_cleanup_lock && release_cleanup_lock && [ ! -d \$CLEANUP_LOCK_DIR ]"

- [x] [BEHAVIOR] zombie-cleaner.js import withLock + findTaskIdForWorktree 扫 .dev-mode*
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/zombie-cleaner.js','utf8');if(!c.includes(\"from './utils/cleanup-lock.js'\"))process.exit(1);if(!c.includes(\"f.startsWith('.dev-mode')\"))process.exit(1)"

- [x] [BEHAVIOR] zombie-sweep / startup-recovery 也 import withLock
  Test: manual:node -e "['zombie-sweep','startup-recovery'].forEach(m=>{const c=require('fs').readFileSync('packages/brain/src/'+m+'.js','utf8');if(!c.includes(\"from './utils/cleanup-lock.js'\"))process.exit(1)})"

- [x] [BEHAVIOR] cleanup-merged-worktrees.sh + cecelia-run.sh source cleanup-lock helper
  Test: manual:node -e "const fs=require('fs');const a=fs.readFileSync('packages/brain/scripts/cleanup-merged-worktrees.sh','utf8');const b=fs.readFileSync('packages/brain/scripts/cecelia-run.sh','utf8');if(!a.includes('cleanup-lock.sh')||!b.includes('cleanup-lock.sh'))process.exit(1)"

- [x] [BEHAVIOR] lint-test-pairing 加内容校验段（非 skip 的 it/test/expect）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/scripts/lint-test-pairing.sh','utf8');if(!c.includes('EMPTY_TESTS')||!c.includes('SKIPPED_ONLY'))process.exit(1)"

- [x] [BEHAVIOR] lint-feature-has-smoke 加内容校验段（≥5 行 + ≥1 真命令）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/scripts/lint-feature-has-smoke.sh','utf8');if(!c.includes('EMPTY_SMOKE')||!c.includes('curl|psql|docker'))process.exit(1)"

- [x] [BEHAVIOR] lint-tdd-commit-order 加非 skip 校验段
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/scripts/lint-tdd-commit-order.sh','utf8');if(!c.includes('REAL_TEST_FOUND')||!c.includes('ADDED_NONSKIP'))process.exit(1)"
