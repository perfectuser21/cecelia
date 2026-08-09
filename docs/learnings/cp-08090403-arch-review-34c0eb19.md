---
id: cp-08090403-arch-review-34c0eb19
task_id: 34c0eb19-5c43-4e56-ab2c-2ec3e5f28a8e
created: 2026-08-09
category: architecture-review
---

# 04:03 UTC 架构巡检 Learning

## 反复出现的合同断链

review runner 把 run id 写进锁文件、把 executor kind 写进 task 列，却不写 callback 使用的 `payload.current_run_id`；recovery 查询又漏掉已经写入的 `executor_kind`。每个局部都有“成功写入”的证据，组合后仍无法形成唯一执行身份。以后验收异步 runner 必须用同一个 task 逐项证明 claim、lock、run-id、heartbeat、recovery 投影与 callback CAS 全部共享同一身份。

## 部署漂移探针要覆盖调用者环境

compose 文件与 `.env` 相同，不代表重部署确定。`staging-deploy.sh` 从生产容器执行时会继承生产容器的 `DB_HOST`，从宿主执行则走 compose 默认值；调用入口本身也是持久化配置推导的一部分。以后探针 C 除了比较文件与 runtime，还要检查部署命令显式传入了哪些关键变量、哪些变量会从调用者环境隐式继承。

## 测试通过必须证明入口真的收集到测试

仓库根 Vitest 配置不包含 `packages/brain/src/**`，同一组参数从根运行会明确返回 no tests；切到 `packages/brain` 配置后才真实执行 18 文件 / 272 tests。巡检报告必须记录收集到的 test files/tests 数量，不能只记录命令退出状态或“执行过 Vitest”。
