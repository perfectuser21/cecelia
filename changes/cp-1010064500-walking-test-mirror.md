## Brain {VERSION} — CI：只改 workflow 的 PR 也跑 brain fs 守卫组；walking 断言跟进镜像源

- #6168 把 walking-ci-e2e 的 worker 镜像改为从 mirror.gcr.io 拉取再 tag 回 `alpine:latest`，`walking-ci-owner.test.js` 仍断言旧字面量 `docker pull alpine`，合并后 main 的 brain-unit (3) 红（任务 a3e63245）。
- 根因：brain-unit「Determine test scope」在 PR 无 brain 变更时判 `mode=skip` 整片跳过，读 workflow/脚本的 fs 守卫测试漏跑。改为 `mode=guards`，只跑 `list-fs-guard-tests.sh` 选出的守卫组。
- 回归测试 `ci-brain-unit-scope.test.js`：从 ci.yml 抽出判定脚本，放进临时 git 仓库真实执行，只改 workflow 必须判 guards。
