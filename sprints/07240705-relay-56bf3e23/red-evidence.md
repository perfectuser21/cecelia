# Skeleton Red Evidence — Codex Slot 安全硬切换

- 合同分支：`cp-07240705-ws-56bf3e23`
- Red 基线：`60bc854be40e7b8e058e792b19b4b26ad7b39eff`
- Sprint：`sprints/07240705-relay-56bf3e23`
- Task：`56bf3e23-1bba-4c6a-8d19-e32d5d746395`
- 模式：`is_skeleton=true`、`harness_gear=segmented`
- 合同测试已随批准的 GAN 合同存在；本 Red commit 不重复 checkout、不修改测试。

## Red 命令与结果

```bash
DB_URL="${DB_URL:-postgresql://localhost/cecelia}" \
  npx vitest run sprints/07240705-relay-56bf3e23/tests \
  --reporter=json \
  --outputFile=/tmp/codex-slot-red-report.json
```

- exit code：`1`
- total：`29`
- failed：`29`
- passed：`0`
- pending：`0`
- 禁 mock 扫描：`vi.mock|jest.mock|sinon.stub|mockResolvedValue` 零命中
- 失败类型：缺少合同要求的模块/脚本，或现有旧行为不满足合同断言；测试已正常收集并执行，无 TypeScript 语法错误、Vitest 收集故障或 PostgreSQL 连接故障。

主要 Red：

- identity/selector 模块不存在：4 项失败。
- registry/durable lifecycle 模块不存在：5 项失败。
- protocol/credential-store/agent 不存在：6 项失败。
- rollout/reaper/registry 不存在：10 项失败。
- 两个旧入口仍返回旧 SSH/token 路径错误，而非 `broker-only`：2 项断言失败。
- client/agent/installer 脚本未交付：1 项 Bash 兼容测试失败。
- scheduler `JOBS` 未接入 `codex-slot-reaper`：1 项断言失败。

## ws1 → ws8 全红覆盖

合同 DoD 的 10 个 `[ARTIFACT]` oracle 已逐条执行；所有目标均为非零 Red。第 10 条原命令含 Bash 双引号内的 JavaScript `${}` 正则字符，会触发 shell `bad substitution`，该结果不计为有效 Red；已用相同语义、单引号保护的 Node oracle 重跑，exit `1`，确认是 `DEFINITION.md` 缺 Codex Slot 交付导致的 Red。

| Workstream | Red 覆盖 | 结果 |
|---|---|---|
| ws1 | migration、registry、真 PG lifecycle、长期 integration test | 缺 migration/registry/长期回归；合同 lifecycle 5/5 Red |
| ws2 | root config、identity、selector | identity/selector 4/4 Red；config artifact Red |
| ws3 | agent、protocol、auth framing、credential durable write | protocol/auth 相关断言 Red；agent/脚本 artifact Red |
| ws4 | broker/client、精确 schema、handle ownership/readback | schema/ownership/readback 合同断言 Red；client/broker artifact Red |
| ws5 | rollout、reaper、scheduler 60 秒接线 | rollout/reaper 10 项 Red；scheduler 断言 Red |
| ws6 | 双旧入口硬切、installer、Mac Bash gate | 旧入口 2 项断言 Red；Bash/installer/CI artifact Red |
| ws7 | Ubuntu security smoke、xian 双机 host smoke、nightly workflow | smoke 文件与 workflow/allowlist artifact Red |
| ws8 | 长期回归、DEFINITION/VERSION、终验 | 长期回归 artifact Red；规范化版本 oracle exit 1 |

## 合同测试只读校验

批准测试在 Red 前后保持以下 Git blob：

```text
c3274e25547aecc5c1e8c6fc8000322d13edda79  codex-slot-identity-routing.contract.test.ts
5d0f390677920b102e154b3cb27b19089e618a07  codex-slot-lifecycle.integration.contract.test.ts
07f7069661c0b56c0f69c0cd803b8927110472a5  codex-slot-protocol-auth.contract.test.ts
1dd1dbab40defdf44f2a004ed35b9f59cce575ad  codex-slot-reaper-rollout.integration.contract.test.ts
```

`contract-draft.md`、`contract-dod.md`、`task-plan.json` 与四份批准测试均与 `origin/cp-07240705-ws-56bf3e23` 逐字节一致。
