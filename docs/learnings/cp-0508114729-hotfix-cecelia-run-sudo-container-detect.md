# cp-0508114729 — Hotfix cecelia-run.sh 容器内跳过 sudo 切 user

**日期**: 2026-05-08
**Branch**: cp-0508114729-hotfix-cecelia-run-sudo-container-detect
**触发**: brain 容器内 cecelia-run.sh exec sudo not found，capability-probe 周期失败 → cecelia-run breaker 周期 OPEN

## 现象

```
$ docker exec cecelia-node-brain bash /Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh
[cecelia-run] 检测到 root 运行，切换到 administrator 重新执行...
/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh: line 31: exec: sudo: not found
```

reset cecelia-run breaker 后 5-15 分钟攒 18-56 failures 又 OPEN，tick scheduler 因 breaker OPEN 拒绝 dispatch 任何 task。

## 根本原因

cecelia-run.sh line 21-32 检测 root 用户（`id -u == 0`）就 exec sudo 切到 administrator。但 brain 容器（cecelia-brain image）内：
- root 运行（容器 default）
- 没装 sudo
- 没 administrator user

`exec sudo: not found` 让 capability-probe dispatch 探针 stderr 输出错误 → 当作探针 fail → breaker 累计 failures → OPEN。

脚本设计假设宿主环境（有 sudo + administrator user），没 detect 容器场景。

## 下次预防

- [ ] **shell 脚本第一行 detect 容器** — 任何 cron 等可能在容器内跑的脚本都要检测 `/.dockerenv` + `command -v sudo`
- [ ] **跨环境脚本必须 wrapper test 4 分支** — host root / host user / container root / container 假 sudo 都要测
- [ ] **smoke.sh 在真 brain 容器跑** — 不只 host 跑，必须 docker exec 跑一遍
- [ ] **probe 失败 stderr 必须 distinguish 错误类型** — sudo not found 跟 dispatch 真挂是两回事，不该都触发 breaker
- [ ] **smoke 部署检测要用精确 grep** — 同一文件可能在多处用同一关键字（如 `/.dockerenv`），grep 必须锚定到具体目标行（`^if .*id -u.*dockerenv`），不能宽 grep

## 修复

- cecelia-run.sh line 22 if 条件加 `&& [[ ! -f /.dockerenv ]] && command -v sudo >/dev/null 2>&1`
- 宿主行为 100% 不变（root + 无 .dockerenv + 有 sudo → 走 sudo 切换）
- 容器内（有 .dockerenv OR 没 sudo）跳过切换直接以 root 跑
- 4 分支 wrapper test + 真容器 smoke E2E（部署前 SKIP，部署后真验证）
- brain version 1.228.5 → 1.228.6

## 长治依赖

[Cecelia Harness Pipeline Journey](https://www.notion.so/Cecelia-Harness-Pipeline-35ac40c2ba6381dba6fbf0c3cb4f1ad4) 长治 sprint 中应该统一规范容器/宿主环境差异层（一个 helper 函数 + 文档约定）。

## PR 链

接力修复 W8 acceptance 卡死路径：
- PR #2837 — propose_branch 协议双修（SKILL JSON 输出 + Graph fallback 命名）
- PR #2838 — inferTaskPlan 加 git fetch（修跨容器 git 状态同步）
- PR #本 — cecelia-run.sh 容器 detect（修 capability-probe breaker 周期 OPEN）
