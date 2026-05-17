# Learning: cp-0505222606 Deploy Clean Build Isolation + 失败可调试

## 概述

长期治本 Brain deploy 三层叠加 bug（PR #2787 实战暴露）：
1. brain-build.sh 用 `git archive HEAD` 隔离脏工作树 → docker build 不再受未 commit 文件污染
2. ops.js deploy-webhook spawn 加 log fd → deploy-local.sh stdout/stderr 落盘可调试
3. deploy/status API 加 `log_path` 字段 → 运维失败时立即知道去哪看 npm error

## 实战触发现场

PR #2787 (consciousness-loop 4-node StateGraph) merged 后 brain-ci-deploy fail，链路如下：

```
18:43 — 某 session（不是触发 PR 的）改主仓库 packages/brain/package.json：
        pg ^8.12.0 → ^8.20.0，未 commit / 未更新 lock
21:45 — PR #2787 merge → Brain webhook 触发 deploy-local.sh
21:45 — brain-deploy.sh → brain-build.sh → docker build $ROOT_DIR
        Docker COPY 用本地工作树 package.json（^8.20.0）vs lock（pg@8.19.0）
21:46 — npm ci EUSAGE：lock file's pg@8.19.0 does not satisfy pg@8.20.0
        → exit 1
21:46 — deploy-webhook 子进程 stdio:'ignore' 把 npm error 全丢
        → status 文件只有 "deploy-local.sh exited code=1 signal=null"
21:46 — GitHub Actions Gate 3 看到 status=failed → exit 1 → P0 告警
```

## 根本原因

**Docker build 不隔离工作树 + 失败静默 + 多 session 并行**三个独立漏洞叠加才出事：

1. `docker build $ROOT_DIR` 把 cwd 整个工作树打进 image（包含未 commit 文件 / untracked 文件 / 脏改动）
2. `spawn(..., { stdio: 'ignore' })` 让子进程输出彻底丢失，运维只看到 exit code 没有 stderr
3. 用户多 session 并行（一个跑 dev，一个改 package.json，一个触发 deploy）— 隔离不够时单点改动污染全局

## 下次预防

- [ ] **build 永远从 git HEAD 拉**，不用 cwd 工作树。`git archive HEAD | tar -x -C $TMP` + `docker build $TMP` 是标准模式
- [ ] **detached spawn 必须把 stdio 落盘到日志文件**，不能 `'ignore'`。状态 API 同步暴露 `log_path` 让运维 0 次猜测就能调试
- [ ] **deploy 链路任何 failure 都要有可调试的日志路径**，不能只有"exited code=1"这种黑盒消息
- [ ] **package.json 版本升级必须 commit + 更新 lock 同 PR 一起**，不能留下"半改"状态影响其他 session
- [ ] **多 session 并行编辑同文件**：未来考虑 deploy hook 跑前检查 git status，dirty 工作树拒绝 deploy（fail-fast 而非污染 image）

## 改动文件

- `scripts/brain-build.sh` — git archive HEAD 隔离 build context
- `packages/brain/src/routes/ops.js` — deploy-webhook spawn 加 log fd + deployState.log_path 字段
- `packages/brain/src/__tests__/deploy-webhook-log.test.js` — 新建 3 case 测试
- `packages/engine/tests/integration/brain-build-isolation.test.sh` — 新建 6 case 测试

## 测试结果

- brain-build-isolation.test.sh：6/6 ✅
- deploy-webhook-log.test.js：3/3 ✅
- deploy-repo-root.test.js（向下兼容）：2/2 ✅
- 既有 brain 全套：7879/7959 pass（2 fail 是 pre-existing 与本 PR 无关）

## 不动的部分

- 不修 pg 版本本身（让相关 session 决定 revert / 完成升级）
- 不改 deploy-local.sh / brain-deploy.sh 主流程
- 不引入 staging 环境隔离（更大范围工作）
