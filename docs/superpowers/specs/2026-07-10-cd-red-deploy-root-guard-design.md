# CD 连红根治：部署根与活人主仓解耦 + 守卫硬红

## 问题
07-10 凌晨起 Gate3/auto-staging-deploy 5 连红（deploy-local.sh exit 125），同日 3 次从干净 cecelia-deploy-main 的人肉部署全部成功。根因：
1. `docker-compose.yml` REPO_ROOT 硬编码指向活人主仓 `~/perfect21/cecelia`；主仓被有头会话切到工作分支+脏改动（reflog 实证 5 红全落在离 main 窗口内）。
2. `deploy-local.sh` git pull 失败仅 warning"继续使用现有代码部署"（静默降级），脏工作分支代码进 brain-deploy → docker 层 125。
3. `brain-deploy.sh` 每次部署写 `.brain-versions`（tracked）→ 部署根自我弄脏 → 下次 pull 又被阻塞（自我复发环）。
4. compose 无 `name:`，项目名跟目录走 → 换部署根跑 compose 会容器名冲突（memory 陷阱实证）。

## 方案（选定：专用部署根 + 双模守卫）
备选对比：
- A. 只加"脏了就硬红"守卫：诚实但 CD 会因主仓被占而常红，治标。
- B. **专用部署根 cecelia-deploy-main + AUTORESET 自愈 + 非专用根硬红守卫（选定）**：CD 与活人工作树彻底解耦；专用根机器独占可 `reset --hard origin/main` 自愈（顺带治 .brain-versions 自脏环）；误指活人仓时因无 AUTORESET 标志而硬红不吃人工作。
- C. 每次部署临时 clone：最干净但每次全量 clone+npm 代价大，且 .env.docker 注入复杂。

## 改动点
1. `docker-compose.yml`
   - 顶层加 `name: cecelia`（项目名与目录解耦）
   - `REPO_ROOT=/Users/administrator/perfect21/cecelia-deploy-main`
   - 加 env `CECELIA_DEPLOY_AUTORESET=1`
   - 加 volume 挂载 deploy-main（rw）
2. `scripts/deploy-local.sh` 部署根守卫（真实模式必跑；测试用 `CECELIA_DEPLOY_FORCE_GUARD=1` 强制开启，配合 `CECELIA_DEPLOY_ROOT` fixture）：
   - `CECELIA_DEPLOY_AUTORESET=1`（专用根）：`git fetch origin main` 失败→exit 1；`git checkout -f main && git reset --hard origin/main`（自愈脏/离main/落后）
   - 无 AUTORESET（可能是活人仓）：branch 必须 =main、tracked 无脏、`git pull --ff-only` 成功，任一不满足 → exit 1 + 具体根因（删除"继续使用现有代码部署"降级）
3. Regression test（先红后绿，永久 CI）：`packages/brain/src/__tests__/deploy-root-guard.test.js`
   - fixture=本地 bare origin + clone
   - 非 main 分支 → exit≠0 且 stderr 含"部署根"
   - main+tracked 脏 → exit≠0
   - AUTORESET + 离 main + 脏 → 自愈后 exit 0（无改动跳过部署）
   - 干净 main → exit 0

## Proven-to-fire
merge 前手动把 fixture（或 dry-run 环境）弄脏跑一次，亲眼见守卫报红；记录在 PR。

## 不包含
- 三把刀（nightly/integration/release gate）——后续独立 PR
- 主仓 cp-07100000-sse-chat-fix 会话的处置（活人会话，不动）
