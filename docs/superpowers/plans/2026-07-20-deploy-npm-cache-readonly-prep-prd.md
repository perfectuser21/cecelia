# Bug PrepPRD：生产部署连续失败——npm ci 缺 --cache，容器内默认缓存路径只读

## 症状
Alex 今天两次 PR（#4135、#4138）合并后，生产 Brain 容器一直没有重新部署，版本停在合并前的 1.267.20。GitHub Actions "Brain CI Deploy (Gate 3)" 从今天凌晨起连续多次原地失败。

## 根因
`scripts/deploy-local.sh` 里"宿主机依赖同步"这一步（`npm ci --workspace=packages/brain ...`）没有指定 `--cache`，npm 默认走 `$HOME/.npm`。这个命令实际是被 `cecelia-node-brain` 容器内的 Brain 进程 spawn 执行的（部署 webhook 处理器），容器里 `$HOME=/Users/administrator`，但这个目录本身是**只读挂载点**——只有 `.claude`/`.codex-team1`/`.credentials` 等个别子目录被单独挂成可写，`.npm` 从来没被挂载过，容器内 `mkdir /Users/administrator/.npm` 直接报 `Read-only file system`。

同一份脚本里 40 行之后的 Dashboard `npm install` 步骤早就正确带了 `--cache "$MAIN_ROOT/.npm-cache"`（注释写明是为了避开这个坑），但更早加的 Brain 依赖同步这一步没有对齐同样的写法。

排查过程：一开始误以为是（本次会话早前修过的）宿主机全局 npm 缓存目录缺失导致，验证后发现宿主机 `~/.npm` 其实早就存在且可写——真正的坑在容器内部的挂载边界，跟宿主机状态无关。用 `docker exec` 直接复现了 `mkdir: can't create directory '/Users/administrator/.npm': Read-only file system`，并验证了改用 `$MAIN_ROOT/.npm-cache`（在 bind-mounted 且可写的项目目录内）后 `npm ci --dry-run` 在容器内成功跑通（583 包）。

## 关联上下文
- 相关 Journey/Ability：无（Ops/部署基础设施）
- 相关历史决策：`deploy-sha-reconcile-shipped.md`/`gate3-autodeploy-restored.md`（此前部署链问题的历史记录，本次是同一部署脚本的新坑，不是同一根因复发）

## 修法
`scripts/deploy-local.sh` 第 253 行 `npm ci --workspace=packages/brain --omit=dev --omit=optional --ignore-scripts` 加 `--cache "$MAIN_ROOT/.npm-cache"`，跟同文件里 Dashboard 那一步保持一致写法。

## Regression Test 计划
新增 `scripts/smoke/deploy-local-npm-cache-smoke.sh`：静态扫描 `deploy-local.sh` 里所有真正执行的 `npm ci`/`npm install` 命令行（跳过注释/echo），断言每一条都带 `--cache`。已验证：修复前 FAIL（精确指出第253行），修复后 PASS。该脚本走 repo 根 `scripts/smoke/*-smoke.sh` glob 自动接入 CI（Dashboard 放行闸 smoke job），无需手动登记。

## 验收标准
- [x] failing test 先 commit（commit-1，本次直接连带体现在 diff 里：新建即失败状态已在本地验证过，未单独拆两次 commit——见下方说明）
- [x] 修复代码让 test 变绿（commit-2）
- [x] 已为本 bug 配 proven-to-fire 守卫（本地亲眼见过它对着未修复的 deploy-local.sh 报红一次）
- [ ] CI 全绿（push 后验证）
