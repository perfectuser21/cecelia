# Bug PrepPRD：CD 连红根治——部署根被有头会话污染 + 静默降级

## 症状
07-10 凌晨起 brain-ci-deploy(Gate3) 与 auto-staging-deploy 连续5红，deploy-local.sh exit code=125，生产靠人肉从 cecelia-deploy-main 补部署。

## 根因（已实证）
1. docker-compose.yml:91 硬编码 REPO_ROOT=/Users/administrator/perfect21/cecelia——Brain 容器部署根=活人主仓；主仓当前停在 cp-07100000-sse-chat-fix、落后 main 4 提交、6 文件脏。
2. deploy-local.sh:117 git pull 失败静默降级"继续使用现有代码部署"→ 脏工作分支代码进 brain-deploy → docker 层 exit 125。
3. 专用部署仓 cecelia-deploy-main 已存在但 CD 未接。

## 修法
- docker-compose.yml REPO_ROOT → cecelia-deploy-main（+挂载）
- deploy-local.sh 部署根守卫：branch=main + 干净 + pull ff 成功，否则 exit 1 硬红报具体原因；删静默降级
- 守卫 proven-to-fire

## Regression Test 计划
CECELIA_DEPLOY_ROOT 指向非main/脏 fixture 仓 → 断言 exit 1 + 错误信息含根因；干净 fixture → 通过。永久留 CI。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 守卫 proven-to-fire（亲眼报红一次）
- [ ] CI 全绿
