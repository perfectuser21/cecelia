branch: cp-0426202402-cicd-a-skill-lint
team: cecelia-cicd-foundation
task: "#1 — A — /dev SKILL 强制 smoke.sh + 4 个 CI lint job"

## 任务标题

/dev SKILL 强制 smoke.sh + 4 CI lint job 机器化纪律

## 任务描述

让 /dev TDD + smoke.sh 纪律不靠 AI 自觉，全部机器化进 CI。SKILL.md 加规则文字段，
ci.yml 加 4 个 PR-only lint job 强制执行：

- lint-test-pairing：新 brain/src/*.js 必须配套 *.test.js
- lint-feature-has-smoke：feat: + 改 brain/src 必须新增 packages/brain/scripts/smoke/*.sh
- lint-base-fresh：PR 落后 main ≤ 5 commits
- lint-tdd-commit-order：含 src 的 commit 之前 PR 系列必须有 *.test.js commit

## DoD

- [x] [BEHAVIOR] SKILL.md 含 "smoke.sh 必须" 字符串
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/SKILL.md','utf8');if(!c.includes('smoke.sh 必须'))process.exit(1)"

- [x] [BEHAVIOR] ci.yml 加 4 个 lint job（lint-test-pairing / lint-feature-has-smoke / lint-base-fresh / lint-tdd-commit-order）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');for(const j of ['lint-test-pairing:','lint-feature-has-smoke:','lint-base-fresh:','lint-tdd-commit-order:'])if(!c.includes(j)){console.error('missing',j);process.exit(1)}"

- [x] [ARTIFACT] 4 个 lint script 存在于 .github/workflows/scripts/
  Test: manual:node -e "for(const f of ['lint-test-pairing.sh','lint-feature-has-smoke.sh','lint-base-fresh.sh','lint-tdd-commit-order.sh'])require('fs').accessSync('.github/workflows/scripts/'+f)"

- [x] [BEHAVIOR] lint-test-pairing 在本 PR 自身验证通过（无新 brain/src js → skip 通过）
  Test: manual:bash .github/workflows/scripts/lint-test-pairing.sh origin/main

- [x] [BEHAVIOR] lint-base-fresh 在本 PR 自身验证通过（fresh from main）
  Test: manual:bash .github/workflows/scripts/lint-base-fresh.sh origin/main

- [x] [BEHAVIOR] ci-passed gate 含 4 个新 lint job
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');for(const j of ['lint-test-pairing','lint-feature-has-smoke','lint-base-fresh','lint-tdd-commit-order'])if(!new RegExp('needs\\\\.'+j+'\\\\.result').test(c)){console.error('ci-passed missing',j);process.exit(1)}"

- [x] [ARTIFACT] Engine 5 文件版本 bump 18.6.0 → 18.7.0
  Test: manual:node -e "const fs=require('fs');for(const f of ['packages/engine/VERSION','packages/engine/.hook-core-version'])if(!fs.readFileSync(f,'utf8').trim().startsWith('18.7.0'))process.exit(1);if(!require('./packages/engine/package.json').version.startsWith('18.7.0'))process.exit(1);if(!require('./packages/engine/package-lock.json').version.startsWith('18.7.0'))process.exit(1)"

- [x] [ARTIFACT] feature-registry.yml 含 18.7.0 changelog 条目
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"18.7.0\"'))process.exit(1)"

- [x] [ARTIFACT] Learning 文档存在
  Test: manual:node -e "require('fs').accessSync('docs/learnings/cp-04262029-cicd-a-skill-lint.md')"

## 目标文件

- packages/engine/skills/dev/SKILL.md
- .github/workflows/ci.yml
- .github/workflows/scripts/lint-test-pairing.sh
- .github/workflows/scripts/lint-feature-has-smoke.sh
- .github/workflows/scripts/lint-base-fresh.sh
- .github/workflows/scripts/lint-tdd-commit-order.sh
- packages/engine/VERSION / .hook-core-version / package.json / package-lock.json / regression-contract.yaml
- packages/engine/feature-registry.yml
- DoD.md
- docs/learnings/cp-04262029-cicd-a-skill-lint.md

## 成功标准

- 4 个 lint script 跑过本 PR 全部 PASS（本地 + CI）
- ci-passed gate 把 4 个新 lint 纳入合并门禁
- SKILL.md 文字 + ci.yml 机器化双保险，未来 feat:+brain 改动 PR 没 smoke.sh 会被 CI 直接拦
