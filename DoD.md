# DoD — skill-drift 端点尊重 process.env.REPO_ROOT

**范围**: harness.js /skill-drift 的 snapshotDir 默认改用 process.env.REPO_ROOT || 模块计算值。
**大小**: XS

## ARTIFACT 条目

- [x] [ARTIFACT] /skill-drift snapshotDir 默认派生自 process.env.REPO_ROOT
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('process.env.REPO_ROOT || REPO_ROOT'))process.exit(1);if(!c.includes('snapshotRepoRoot'))process.exit(1);console.log('OK')"

- [x] [ARTIFACT] 回归测试文件存在（覆盖 REPO_ROOT env fallback 分支）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/__tests__/harness-skill-drift-repo-root.test.js','utf8');if(!c.includes('process.env.REPO_ROOT'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [x] [BEHAVIOR] 设 REPO_ROOT 指向含快照的临时目录、不设 SKILLS_SNAPSHOT_DIR 时，snapshot_version 非 null 且与 SSOT 一致 → any_drift=false（brain-unit CI --changed 实跑此测试）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/__tests__/harness-skill-drift-repo-root.test.js','utf8');['process.env.REPO_ROOT = snapshotRoot','any_drift).toBe(false','snapshot_version).toBe(TEST_VERSION'].forEach(s=>{if(!c.includes(s))process.exit(1)});console.log('OK')"
