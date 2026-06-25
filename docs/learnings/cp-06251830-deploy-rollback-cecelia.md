# 部署生命周期 阶段1 · cecelia 回档落地

> 分支：cp-06251822-cp-deploy-rollback-cecelia
> 日期：2026-06-25
> spec：docs/superpowers/specs/2026-06-25-deploy-lifecycle-tag-rollback-design.md

## 做了什么

给 cecelia 装上"生产 release tag + 旧版留存 + 一键回档"安全网：
- `scripts/promote-dashboard.sh`：promote 不再 `rm -rf dist.old` 删旧版（回档洞），改为把旧 `dist/`
  挪进 `apps/dashboard/.dist-releases/<tag>/` 留存（保留最近 5 份），打统一生产 tag `prod-cecelia-vN`
  （单调递增），写仓库根 `.production-release`（current + 历史追加）。`.dist-releases/` 进 `.gitignore`。
- 新增 `scripts/rollback-cecelia.sh`：无参退上一 tag / 带 tag 从留存 5 份挑（不在留存内报错退出），
  dashboard 原子换回留存版（换入失败回滚到换入前）+ brain `git checkout <tag>` 重启 + 指针回拨；
  brain 回档跨 DB migration 文件变动时要求 `--confirm-db` 才继续。
- 回档 E2E：`packages/engine/tests/integration/deploy-rollback.test.sh`（17 断言），用
  `CECELIA_DEPLOY_ROOT` 测试钩子在隔离临时目录自洽跑，绝不碰真生产 / 真 HK。

## 根本原因

原 promote 路径 `mv dist → dist.old` 后立即 `rm -rf dist.old`，生产被换下的旧产物零留存——
一旦新版炸了，没有任何可回退的产物，违反"生产必须能回档"的安全底线。同时 brain 侧 main=生产、
tag 未用，光退代码不会回退已执行的 DB migration，是隐形二次伤害源。

## 下次预防

- [ ] promote 类脚本一律走"留存 + tag + 指针"三件套，禁止 `rm -rf` 删被换下的生产产物。
- [ ] 本机自带 bash 3.2，禁止用 `mapfile`/`readarray`（3.2 无此内建会静默空数组，本次 prune 因此一度失效）；
      用 `sort | head | while read` 等 3.2 兼容写法，本地真跑过再信 CI 绿。
- [ ] shell 脚本里 `$VAR` 后紧跟中文标点（。（）），`set -u` 下首字节会被并进变量名 → unbound；
      变量后接中文一律写 `${VAR}` 包裹。
- [ ] `grep -c` 本身已输出数字，别再 `|| echo 0`（无匹配时拼出 "0\n0" 破坏 `[[ -gt ]]` 判断）。
- [ ] brain 回档跨 migration 必须显式 `--confirm-db` 拦截，不默默退代码留 schema 漂移。
