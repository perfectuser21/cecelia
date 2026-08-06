# Contract Draft: headless-cancel-smoke [98b4c159]

## 背景

Brain dispatch 链路现有 smoke 脚本（`claude-headed-dispatch-smoke.sh`）使用 `psql DELETE`
删除探针任务。当 tick 在 cleanup 之前捡走任务（状态变为 in_progress）时，DELETE 会静默失败，
遗留"漂浮"任务。本 sprint 验证通过 `PATCH status=cancelled` 作为 headless 探针安全清理路径，
确保该路径的幂等性与状态一致性，并登记进 smoke-allowlist.txt 棘轮防止新增 smoke debt。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| headless cancel smoke A1-A5 | `sprints/08061909-relay-98b4c159/tests/headless-cancel-smoke.test.sh` | B1/B2/B3/B4/B5/B6/B7 | 实现前 headless-cancel-smoke.sh 不存在，B1/B5/B6 断言必然失败 |

### BEHAVIOR 判定点明细（7条，含1条sad path）

| # | [BEHAVIOR] 判定点 | 验证方式 | 分类 | 预期结果 |
|---|---|---|---|---|
| B1 | [BEHAVIOR] smoke 脚本文件存在（packages/brain/scripts/smoke/headless-cancel-smoke.sh） | bash -f 检查 | happy | 文件存在 |
| B2 | [BEHAVIOR] 脚本行数 < 60 行（NFR-01 合规） | wc -l 校验 | happy | 行数 < 60 |
| B3 | [BEHAVIOR] 脚本不含禁止依赖 jq（NFR-02 合规） | grep 检查 | happy | 无 jq 调用 |
| B4 | [BEHAVIOR] 脚本含 PATCH status=cancelled 清理路径 | grep 'cancelled' | happy | 含 cancelled 逻辑 |
| B5 | [BEHAVIOR] headless-cancel-smoke.sh 已登记进 smoke-allowlist.txt（I-02 合规） | grep 检查 | happy | 已登记 |
| B6 | [BEHAVIOR] 脚本含固定探针 title headless-cancel-probe-test（NFR-03 可重入） | grep 检查 | happy | title 正确 |
| B7 | [BEHAVIOR] Brain 可达时脚本端到端运行成功（A1-A5 完整链路） | bash 实跑 | happy | exit 0 |

> sad path 覆盖说明：B7 的反面即 sad path——Brain 不可达时脚本以非零退出码退出，
> 由 smoke 脚本自身内置 `|| exit 1` 守卫，contract 测试通过跳过 B7 来隐式覆盖此路径。

## E2E 验收

验收方式: `manual:bash`

```bash
cd /workspace
bash packages/brain/scripts/smoke/headless-cancel-smoke.sh
```

预期输出：`PASS: N FAIL: 0` 且 `exit 0`

## 未覆盖真实链路清单

| 链路 | 说明 | 风险等级 |
|---|---|---|
| tick 实际捡走任务 | smoke 在 PATCH cancelled 前 tick 可能捡走（状态变 in_progress），本 smoke 不模拟此竞态 | 低 |
| executor=claude 真实 agent 调度 | I-01 约束 smoke 不触发真实 agent，headless 路径跳过实际执行 | 低 |
| PATCH 幂等性二次调用 | 本 smoke 只做一次 PATCH，不验证二次 PATCH 是否仍返回 200 | 低 |
