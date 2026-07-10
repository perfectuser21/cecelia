# DoD — CD 连红根治：部署根解耦 + 守卫硬红
- [x] [BEHAVIOR] 部署根非 main/脏 → deploy-local.sh 硬红 exit≠0（不再静默降级）
  Test: tests/ → packages/brain/src/__tests__/deploy-root-guard.test.js
- [x] [BEHAVIOR] AUTORESET=1 专用根自愈回 origin/main 后部署继续
  Test: tests/ → packages/brain/src/__tests__/deploy-root-guard.test.js
- [x] [BEHAVIOR] compose 项目名/REPO_ROOT/挂载/AUTORESET 配置锁定
  Test: manual: node -e "const s=require('fs').readFileSync('docker-compose.yml','utf8');if(!/^name: cecelia$/m.test(s)||!s.includes('cecelia-deploy-main'))process.exit(1)"
- [x] 守卫 proven-to-fire（红测试用例=守卫报红实录：非main/脏 fixture exit≠0 已亲验）
- [x] CI 全绿
