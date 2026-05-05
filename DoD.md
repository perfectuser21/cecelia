# DoD: cp-0505230127 deploy-origin-main-isolation

## 概述
方案 C followup：deploy 工具链对 cwd 分支彻底免疫。即使主仓库 cwd 在 cp-* 分支
（被另一个 session 占用）、本地 main 落后 origin/main、工作树脏，brain-build.sh
仍然 build 出 origin/main 最新代码（含已合并修复）。

## 验收

- [x] [BEHAVIOR] brain-build.sh 用 git fetch origin + git archive FETCH_HEAD 而非 HEAD
  Test: manual:bash packages/engine/tests/integration/brain-build-isolation.test.sh

- [x] [BEHAVIOR] cwd 在 cp-* 分支时 git archive FETCH_HEAD 拿 origin/main 不是 HEAD
  Test: manual:bash packages/engine/tests/integration/brain-build-isolation.test.sh

- [x] [BEHAVIOR] brain-build.sh 含 git fetch origin 拉最新 main
  Test: manual:bash packages/engine/tests/integration/brain-build-isolation.test.sh

- [x] [BEHAVIOR] v1.1.0 git archive 隔离脏工作树继承（不破坏既有行为）
  Test: manual:bash packages/engine/tests/integration/brain-build-isolation.test.sh

- [x] [ARTIFACT] brain-build.sh 含 FETCH_HEAD 关键调用
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-build.sh','utf8'); if (!c.includes('FETCH_HEAD')) process.exit(1)"

- [x] [ARTIFACT] brain-build.sh 含 git fetch origin
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-build.sh','utf8'); if (!c.match(/git -C .* fetch origin/)) process.exit(1)"

- [x] [ARTIFACT] brain-build.sh DEPLOY_BRANCH 默认 main
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-build.sh','utf8'); if (!c.includes('DEPLOY_BRANCH')) process.exit(1)"

- [x] [ARTIFACT] brain-build.sh VERSION 从 origin/main 读取
  Test: manual:node -e "const c=require('fs').readFileSync('scripts/brain-build.sh','utf8'); if (!c.match(/git -C .* show .origin\\/.*package\\.json/)) process.exit(1)"
