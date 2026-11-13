---
id: current-ci-pipeline
version: 3.0.0
updated: 2026-11-12
authority: CURRENT_STATE
---

# Cecelia CI

实际命令以 `.github/workflows/`、`scripts/ci/run-basic-check.mjs` 为准。以下区分源码验收、隔离运行与生产监控；源码绿色不能证明生产业务执行成功。

## PR 与 main

只有 `ci.yml` 承担 PR 合并前 CI。main push 复用同一入口并跑全部现役服务组件。

| job | 实际责任 |
|---|---|
| plan | 固定BASE/HEAD核对版本增量，并选择受影响组件的整套检查 |
| security | 凭据扫描、运行依赖high及全部依赖critical漏洞审计 |
| checks | Brain六分片、5个明确PG合同与源码运行、镜像构建、共享前端、Ops及scripts；MCP仅包自身变更触发 |
| resource-canaries | 真实Docker离线实例/RPC、共享预算/OOM与cgroup观测 |
| runtime-integration | 机器接入、Linux授权的真实PG合同，以及公共Runner/Commander进程故障恢复 |
| pwa-upgrade | Chromium验证PWA升级、交办回执、指挥舱收件箱和去向路由；业务API为隔离fixture |
| skill-contracts | 固定外置正文来源身份；Linux执行Brain/root合同，Windows和macOS恢复验证 |
| codeql | Actions、JS/TS、Python三个语言安全分析；另有每周扫描 |
| preview-deploy | 同仓UI变更PR按需启动预览，并核对SHA和活动回执 |
| preview-cleanup | PR关闭后回收预览，必须取得inactive或确认不存在的业务终态 |
| ci-passed | 汇总plan/security/checks/resource/runtime/browser/skill/codeql八个父任务，所有被选矩阵必须成功 |

唯一汇总名为 `源码保底通过`。合并保护以GitHub当前分支保护及规则集为准；2026-11-12实读该项绑定GitHub Actions App 15368，strict=true。预览部署/回收不作为这八项之一。

## 实际组件边界

- Brain普通单测、PG、源码HTTP生命周期和Docker构建是不同证据；PR镜像只build，不代表已启动生产服务。
- `apps/api`只保留Dashboard共享features和captures schema验证，不再有独立旧Core服务、Conductor、旧任务/OKR路由或后端编译入口。
- 共享features与Dashboard在一个组件任务中依次使用各自React/Vitest环境，再构建Dashboard，不能混用React18/19测试环境。
- Ops按固定PR差异选择执行域；公共配置、未知来源和全量运行执行56个现役入口。21个旧Runner兼容回归仅由 `node scripts/ci/run-legacy-runner-checks.mjs` 显式执行，不作为现役WorkflowRunner验收。
- scripts检查CI本身的真实选择/退出/权限边界、开发工具、事实与版本一致、迁移编号及Skill所有权。默认53个Node入口；W19冻结、旧准入发布器和一次性历史授权回放已退出。两个仍被可选API消费的窄合同由 `node scripts/ci/run-legacy-checks.mjs` 显式执行。
- 独立MCP不进入现役服务全量矩阵或夜间PG回归；包自身变更仍运行单测，PG合同保留显式 `npm run test:pg -w packages/mcp-readonly`，需专用测试库。
- 外置Skill正文只在固定来源恢复后执行专属合同；普通单测不依赖本机私有正文。所有权由同一Python实现提供。
- 本地quickcheck只做准备：Brain lint、共享前端的Dashboard构建；CI或根依赖变更另跑scripts。真实命令失败必须阻止push。

## 深度回归与监控

| workflow | 触发 | 实际用途 |
|---|---|---|
| nightly-regression.yml | 每天北京时间03:00及按需 | 私有PG与完整数据库回归、captures schema、隔离launcher；另启动Brain镜像连接本人专用PG，运行Map Manifest正例 |
| heartbeat-sentinel.yml | 每30分钟及按需 | 从GitHub反向探测生产health，并确认main深度回归26小时内有成功回执；异常告警、恢复收口 |
| ci-red-alert.yml | 每6小时及按需 | 跨四仓检测最近连续三次失败并开Issue、通知；与源码必需检查分开 |

深度回归的 `real-env-smoke` 使用GitHub隔离容器与专用PG，不是手机真机或生产账号验收。通用CI不占用手机、社媒账号或线上业务资源。

## 使用边界

数据库测试只连接本轮拥有的本机scratch或CI服务，拒绝默认生产连接。生产部署另按实际发布入口和部署技能验收；旧自动staging、Gate3部署、Implementation impact、Learning月归档及合并文档清理不再构成当前自动CI。

当前来源与执行资格需要固定Git、真实输入、owner和权限边界；历史工作流曾经绿色不能为新候选授予资格。退役历史接受矩阵不应通过宽松解析或默认成功替代。

```bash
npm ci --ignore-scripts
node scripts/ci/run-basic-check.mjs scripts
node scripts/ci/run-basic-check.mjs dashboard
node scripts/ci/run-basic-check.mjs brain-unit 1
```
