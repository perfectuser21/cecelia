# deploy.sh 统一部署入口

### 背景
Cecelia 有 6+ 个分散的部署脚本，每次 deploy 要记住改了什么跑哪个。

### 解决方案
新增 `scripts/deploy.sh` 作为统一入口：
- 自动 `git diff` 检测 brain/dashboard 是否有改动
- 无改动 → 只跑 smoke，不 rebuild（幂等）
- 支持 `--brain-only` / `--dashboard-only` / `--skip-smoke` flag
- brain 失败 → exit 1，不继续 dashboard

### 根本原因
无统一入口导致认知负担，且容易漏跑某一侧的 rebuild。

### 下次预防
- [ ] post-merge-deploy.sh / staging-deploy.sh 不动，接口不变
- [ ] 新增 deploy 场景优先扩展 deploy.sh flag，而非新建脚本
