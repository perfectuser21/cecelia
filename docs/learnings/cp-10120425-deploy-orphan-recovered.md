## 部署台账孤儿 pending 带外结算为 recovered（2026-10-12）

### 根本原因
部署进程（POST /api/brain/deploy → deploy-local.sh → brain-deploy.sh）在它要替换的 Brain 容器里 spawn detached，只脱离了父进程，没脱离容器。10-10 06:31 Brain 主进程 exit 1 被 restart policy 拉起，部署进程随容器一起被 SIGKILL，brain-deploy.sh 的 trap EXIT（唯一结算出口）没跑，pending 留在 ledger。下一次 begin 的 reconcile 只会 finish(success)，容器仍是旧镜像必然 DEPLOY_IMAGE_MISMATCH；就算改走 recovered，finish 也要求旧镜像“实时”带版本 tag，而同版本号重建已把 tag 打到新镜像上，必然 DEPLOY_HEALTH_MISMATCH。原回归测试还把“仍是旧镜像 → 抛错且保留 pending”固化成了期望，等于把孤儿写成规格。

### 下次预防
- [ ] 结算出口不能只放在被结算对象同进程/同容器的 trap 里：SIGKILL 下 trap 不执行，必须有带外 reconcile，且每种终态（success/recovered）都要有出口
- [ ] 身份核验用内容寻址的镜像 id + begin 时快照，不用会被覆盖的实时 tag
- [ ] 写回归测试时警惕把“当前卡死的行为”固化为期望（旧测试 103-106 行）
- [ ] bash 双引号里 `$var` 后紧跟全角标点会被并进变量名，一律写 `${var}`
- [ ] 阶段二（未做）：部署执行体移出 Brain 容器（独立 runner 容器），并让 drift-sentinel 补部署不再 exec 超时 300s
