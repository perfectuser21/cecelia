# Bug PrepPRD：pre-swap smoke 容器内 jq 缺失 4 连假红

## 症状
1.262.1 第 4 次部署：green 健康、5230 可达（#3913 修复生效），但 pre-swap smoke 4/5 红，全部 `jq: command not found`。

## 根因
deploy-webhook 在 brain 容器内跑 pre-swap smoke，容器无 jq；四条核心 smoke（healthz/version/harness-ping/harness-echo）断言依赖 jq。bluegreen 的 bark 已修过 nojq（bluegreen-bark-nojq-smoke），smoke 本身漏了同一课。

## 修法
四脚本注入自包含 node shim：jq 缺失时以 bash 函数兜底本脚本用到的 jq 子集（./-r/-e type/==/keys）。有 jq 环境零变化。

## Regression Test 计划
守卫 proven-to-fire：第 4 次部署失败即红证据；本地无 jq PATH 实跑 4/4 绿（shim pretty-print 实锤）。

## 验收标准
- [x] 无 jq PATH 四条全绿
- [ ] CI 绿 merge → Gate3 重跑 → 生产 1.262.1
