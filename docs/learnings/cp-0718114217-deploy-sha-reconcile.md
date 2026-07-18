## Dashboard 部署静默跳过根治——判变改生产自报 SHA 对账（2026-07-18）

### 根本原因
1. 专用部署根（cecelia-deploy-main）每次部署先 `reset --hard origin/main`，之后 `git diff origin/main...HEAD` 恒空——dashboard 改动检测结构性失效，#4022/#4038 合并后两次部署日志实证判"无改动"跳过，指挥舱三天没上线零告警。Brain 有生产 git_sha 对账兜底，dashboard 没有对应机制。
2. Brain SHA 对账跑在守卫 fetch 之前（旧 origin/main 引用），且 `rev-parse` 无 `--verify` 时失败会回显字面量导致 ORIGIN_SHA 非空假有值。
3. promote 的 HK 同步/指纹终验失败全降级 warning——静默失败链第三环。
4. 隐藏雷（本次连带引爆两处）：隔离测试模式（CECELIA_DEPLOY_ROOT）下 deploy-local 的 Brain 对账仍 curl 真生产、gate-smoke [B] 的 promote full 模式真实执行 brain-deploy.sh（/tmp/cecelia-deploy-status.json 被 smoke 污染成 failed 实证）；smoke 还向共享 refs 泄漏 prod-cecelia-vN tag（v2-v7 残留）。

### 下次预防
- [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱
- [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸死 set -e 脚本）
- [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子逐个显式设，跳过项列在 smoke 头注释
- [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量
- [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面
