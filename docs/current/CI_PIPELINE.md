---
id: current-ci-pipeline
version: 3.0.9
updated: 2026-11-16
authority: CURRENT_STATE
---

# Cecelia CI

实际命令以 `.github/workflows/`、`scripts/ci/run-basic-check.mjs` 为准。以下区分源码验收、隔离运行与生产监控；源码绿色不能证明生产业务执行成功。

## PR 与 main

只有 `ci.yml` 承担 PR 合并前 CI。PR与main push固定执行现役核心组件，不再根据修改路径减少源码或Ops检查。

现有4份工作流：主CI、夜间深度回归、健康哨兵和CI红灯告警。无实际调用方、发布计划生成器或业务安装步骤的 `workflow-foundation-release.yml` 模板已清退。Workflow发布、真实PG注册与故障恢复验收仍在主CI的 `runtime-integration` 中；`foundation-publish.mjs` 保留为已部署业务包验收后的注册脚本。此次清退没有接入或触发生产自动部署/注册。

| job | 实际责任 |
|---|---|
| security | 凭据扫描、运行依赖high及全部依赖critical漏洞审计 |
| checks | Brain六分片、10个明确PG入口与源码运行、镜像构建、共享前端、Ops及scripts；Scripts矩阵入口检查固定BASE/HEAD版本递增 |
| runtime-integration | 机器接入、Linux授权的真实PG合同，以及公共Runner/Commander进程故障恢复；纯mock隔离回归仅在普通单测执行 |
| pwa-upgrade | Chromium验证PWA升级、交办回执、指挥舱收件箱和去向路由；业务API为隔离fixture |
| codeql | Actions、JS/TS、Python三个语言安全分析；另有每周扫描 |
| preview-deploy | 在自身入口核实固定PR BASE/HEAD后，同仓UI变更PR按需启动预览，并核对SHA、库、Tick和活动回执；该身份核验不代表UI页面验收 |
| preview-cleanup | PR关闭后回收预览，必须取得inactive或确认不存在的业务终态；无记录不发送成功评论 |
| ci-passed | 汇总security/checks/runtime/browser/codeql五个父任务，所有被选矩阵必须成功 |

唯一汇总名为 `源码保底通过`。合并保护以GitHub当前分支保护及规则集为准；2026-11-12实读该项绑定GitHub Actions App 15368，strict=true。预览部署/回收不作为这五项之一。

独立Linux资源Canary及其计划/汇总协议已清退；生产采样器与资源失败分类保留。按最近PR的同等组件范围，此后移除Plan准备runner，常规全量条目再减少1个；组件测试数量与此不同。

## 实际组件边界

- Brain普通单测、PG、源码HTTP生命周期和Docker构建是不同证据；PR镜像只build，不代表已启动生产服务。
- `apps/api`只保留Dashboard共享features和captures schema验证，不再有独立旧Core服务、Conductor、旧任务/OKR路由或后端编译入口。
- 共享features与Dashboard在一个组件任务中依次使用各自React/Vitest环境，再构建Dashboard，不能混用React18/19测试环境。
- Ops始终执行59个现役入口。无生产上游的旧spawn/host/Docker执行器及专属测试、无调用的汇总脚本均已清退；现役fleet执行器保留。
- scripts检查CI本身的真实选择/退出/权限边界、开发工具、事实与版本一致、迁移编号及Skill所有权。默认按目录发现现役Node入口；W19冻结、旧准入发布器和一次性历史授权回放已退出。两个仍被可选API消费的窄合同由 `node scripts/ci/run-legacy-checks.mjs` 显式执行。
- 独立MCP不进入现役核心矩阵或夜间PG回归；单测保留显式 `node scripts/ci/run-basic-check.mjs mcp`，PG合同保留显式 `npm run test:pg -w packages/mcp-readonly`，需专用测试库。
- 外置Skill正文、固定版本与关键词专属合同已退出本仓PR验收；普通单测不依赖本机私有正文。通用恢复器及Python所有权检查仍保留。
- 本地quickcheck只做准备：Brain lint、共享前端的Dashboard构建；CI或根依赖变更另跑scripts。真实命令失败必须阻止push。

原466份shell烟测已逐项审读，累计清退198份。最新一轮对93份待审项追溯建立目的、现役业务入口和断言效果：86份旧壳清退，必要边界迁入实际函数/路由、受控CLI与私有PG测试；7份保留（合同版本、invariants读回、部署节点profile、fleet回执schema、DBOS模块启动、内部模块健康账本、专属控制器权限）。现存268份；本轮93份均有明确处置，不再作为未核实项挂起。另清退两份无现役调用且硬读退役脚本的历史E2E副本。脚本文件数不是PR job数。现役模块、真实函数/HTTP/PG回归及部署扫描器保留。安全fixture会在执行前拒绝缺失的被测入口，避免把shell未执行造成的无副作用误判为安全验证通过。 当前10项PG选择由固定完整来源封组及静态输入闭包共同证明；添加新定义不会放宽对缺失、篡改或新旧控制字节混配的拒绝。

`fleet-worker-workspace` 与 `kernel-runtime-resource` 的实际验证保留，移除其已删除旧suite委托；受控shell回归核对完整现役suite集合和失败退出码，不点火真实Docker/PG。

## 深度回归与监控

| workflow | 触发 | 实际用途 |
|---|---|---|
| nightly-regression.yml | 每天北京时间03:00及按需 | 私有PG与完整数据库回归、captures schema、隔离launcher；另启动Brain镜像连接本人专用PG，运行Map Manifest正例 |
| heartbeat-sentinel.yml | 每30分钟及按需 | 从GitHub反向探测生产health，并确认main深度回归26小时内有成功回执；异常告警、恢复收口 |
| ci-red-alert.yml | 每6小时及按需 | 跨四仓检测最近连续三次失败并开Issue、通知；与源码必需检查分开 |

夜间完整数据库回归为Commander审计另建同一CI服务拥有的 `cecelia_scratch` 并显式传入 `TEST_DB_URL`；其余回归保持原 `cecelia_test`。Commander文件此前在此入口会仅跑3项本地检查并跳过9项PG用例；修复后已在独占空scratch实测12项全部执行，生产库不参与。

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
