# Sprint PRD: headless-dispatch-smoke

## 目标

新增 `headless-dispatch-smoke.sh`——专项验证 headless（Docker）派发链路的 smoke 脚本，
填补 `claude-headed-dispatch-smoke.sh` / `codex-headed-dispatch-smoke.sh` 只在第 3 步
附带验证 headless API 合法性的盲区：没有专属脚本系统性守卫 headless 路径
（docker-executor CECELIA_HEADLESS 注入、task-tasks mode 白名单、
slot-allocator PPID 检测）的完整行为集合。

## Invariant 约束

1. 不改任何既有 smoke 脚本行为——仅新增，不修改现有文件逻辑
2. 现有 CI 全绿——brain-ci、engine-ci 无新失败
3. 新脚本须加入 `packages/quality/smoke-allowlist.txt`（棘轮闸，新债不许欠）
4. 新脚本需被 brain-ci.yml smoke job 覆盖（existing glob 已收集 `packages/brain/scripts/smoke/*.sh`）

## 累积 FR

| ID  | 描述 |
|-----|------|
| FR1 | 新建 `packages/brain/scripts/smoke/headless-dispatch-smoke.sh` |
| FR2 | 验证 `task-tasks.js` mode 白名单：mode=headless → 200/201；mode=invalid → 400 |
| FR3 | 验证 `docker-executor.js` 含 `CECELIA_HEADLESS: 'true'` 环境注入 |
| FR4 | 验证 `slot-allocator.js` 含 PPID CECELIA_HEADLESS=true 检测逻辑 |
| FR5 | 验证 `harness-skill-relay.js` 默认（mode 缺省/headless）走 docker spawnFn |
| FR6 | 加入 `packages/quality/smoke-allowlist.txt` |

## Golden Path

1. Brain API 在线，`curl localhost:5221/healthz` → 200
2. `POST /api/brain/tasks(mode=headless, executor=claude)` → 200/201 + id 字段存在
3. `POST /api/brain/tasks(mode=headless, executor=codex)` → 200/201
4. `POST /api/brain/tasks(mode=invalid)` → 400 拒绝
5. `docker-executor.js` 源码含 `CECELIA_HEADLESS: 'true'` 注入行
6. `slot-allocator.js` 源码含 PPID CECELIA_HEADLESS 检测逻辑
7. `harness-skill-relay.js` 含"headless 走 spawnFn(docker)"注释/逻辑
8. smoke 脚本全部 PASS → exit 0

## NFR

- smoke 脚本无外部依赖（curl + node 内联检查 + Brain API）
- 单脚本运行时 < 10s
- 无需 Docker 真实运行（code-inspection 方式验证，CI 友好）

## 验收标准（E2E）

```bash
bash packages/brain/scripts/smoke/headless-dispatch-smoke.sh
# 预期：全部 ✅，PASS: N FAIL: 0，exit 0

grep "headless-dispatch-smoke.sh" packages/quality/smoke-allowlist.txt
# 预期：找到该行（exit 0）
```

---

journey_type: smoke_test
target_environment: local_api
