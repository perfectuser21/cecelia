# DoD: startup-recovery 加 docker container 活跃性保护

## 验收清单

- [x] [BEHAVIOR] 活跃 container 的 worktree 不被 cleanup
  Test: tests/__tests__/startup-recovery-active-container-protect.test.js

- [x] [BEHAVIOR] docker probe 失败时安全降级（保守跳过删除，记 warn）
  Test: tests/__tests__/startup-recovery-active-container-protect.test.js

- [x] [BEHAVIOR] docker probe 返回空 / 路径不匹配仍能删除真正 orphan dir（不破坏既有能力）
  Test: tests/__tests__/startup-recovery-active-container-protect.test.js

- [x] [ARTIFACT] startup-recovery.js 含 `docker ps` 调用代码
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/startup-recovery.js','utf8');if(!c.includes('docker ps'))process.exit(1)"

- [x] [ARTIFACT] startup-recovery.js 含 `getActiveContainerMountPaths` 实现
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/startup-recovery.js','utf8');if(!c.includes('getActiveContainerMountPaths'))process.exit(1)"

## Learning 路径

docs/learnings/cp-50714605-startup-recovery-active-container.md
