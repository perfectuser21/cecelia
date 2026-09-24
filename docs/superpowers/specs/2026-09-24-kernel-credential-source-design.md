# 设计：kernel-v1 远程 run 凭据来源修复（credential_payload_invalid）— 2026-09-24

任务 d3764629（接替 91211a1c）· 决策 fbe2146c（bug-fix）· PrepPRD：Brain notes 3e5c40c2

## 问题

MMV 的 fleet-worker 以服务用户 `_cecelia`（HOME=/var/empty）spawn `run.js`；run.js 为 codex attempt 签发凭据信封时经 `resolveProviderAccountHome`（`os.homedir()`）找 `/var/empty/.codex-teamN/auth.json` → 不存在；即使指向真实目录 `/Users/administrator/.codex-teamN/auth.json`（属 administrator，0644），`createFileCredentialLoader` 的「属主==进程 uid 且恰为 0600/0400」校验也拒绝；`createCredentialBroker.issue` 又把所有加载错误改写成 `credential_payload_invalid`，诊断被抹。安装版 `orchestrator-runner.cjs` 含 09-20 本地热修（runner 路径走 runner-checkout、`CECELIA_SKILLS_ROOT`）未回填仓库。

## 架构

| 单元 | 职责 | 接口 |
|---|---|---|
| M1 `orchestrator/credential-broker.js` | `issue` 透传 loader 的 `credential_*` 码；loader 增 `trustedUids`、放宽权限规则、校验父目录 | `createFileCredentialLoader({ accountHomeResolver, trustedUids=[], statDirectory })` |
| M2 `orchestrator/provider-account-home.js`（新） | 账号目录名解析单一真身；`resolveProviderAccountHome`（执行目录，仍 `os.homedir()`）与 `resolveCredentialAccountHome`（凭据目录，读 `CECELIA_CREDENTIAL_HOME_ROOT`）分离；`parseTrustedUids` | `providerAccountDirName(provider, account)`；`resolveProviderAccountHome(provider, account)`；`resolveCredentialAccountHome(provider, account, { env })`；`parseTrustedUids(env)` |
| M3 `run.js` / `harness-relay-watchdog.js` | loader 改用 M2 的凭据目录解析与 trustedUids | 无新公开接口 |
| M4 `scripts/fleet-worker/orchestrator-runner.cjs` | start 前探测凭据根（`CECELIA_ORBSTACK_HOME`）下 `.codex-team{1..5}/auth.json` 至少一个可读，否则 500 `orchestrator_credential_home_unavailable` 不 spawn；spawn env 注入 `CECELIA_CREDENTIAL_HOME_ROOT`、`CECELIA_CREDENTIAL_TRUSTED_UIDS=<根目录属主 uid>`；回填热修（runner 路径与 `CECELIA_SKILLS_ROOT` 走 `CECELIA_ORCHESTRATOR_RUNNER_ROOT`，默认 `/private/var/lib/cecelia/runner-checkout`） | `createOrchestratorRunner({ …, probeCredentialHome })` |

`dispatcher.js` 的 `resolveProviderAccountHome` 改为从 M2 re-export，调用方不变（execution.codexHome 语义不变——那是给容器挂载用的宿主路径）。

## 数据流

```
Brain(us-vps) → fleet-worker prepare/start(MMV, _cecelia)
  start: probeCredentialHome(CECELIA_ORBSTACK_HOME) → {root, uid} 或 500
       → spawn run.js env{CECELIA_CREDENTIAL_HOME_ROOT=root, CECELIA_CREDENTIAL_TRUSTED_UIDS=uid}
run.js: loader(accountHomeResolver=resolveCredentialAccountHome(env), trustedUids=parseTrustedUids(env))
  → open O_NOFOLLOW → fstat: isFile ∧ uid∈{getuid()}∪trusted ∧ mode&0o400 ∧ !(mode&0o022) ∧ !(mode&0o111)
  → 父目录 lstat: 非符号链接 ∧ uid 可信 ∧ !(mode&0o022)
  → broker.issue: loader 抛 credential_* 原样上抛；JSON 非法才 payload_invalid
```

## 权限规则变更说明

旧规则要求 0600/0400 且属主==进程 uid。现实：凭据由 administrator 的 codex CLI / 刷新脚本产出，权限不受本仓库控制（当前 0644）。本仓库 loader 的职责收敛为「拒绝可被他人篡改/伪造的来源」：属主必须可信（进程 uid 或 fleet-worker 显式声明的宿主属主）、文件与父目录不得被组/其他人写、不得是符号链接、不得带执行位。保密性（改回 0600）由源侧脚本负责（后续刀 6378efbf）。

信任假设（残余风险，明示）：凭据根目录（`CECELIA_CREDENTIAL_HOME_ROOT`，现网 `/Users/administrator`）及其祖先目录由可信方控制、不可被其他用户写。loader 只校验最后一级目录与文件；若祖父目录可被他人写，攻击者可在 lstat 与 open 之间换目录或放硬链接（macOS 无 protected_hardlinks）指向属主相同的其它 0644 文件。属主 uid 非整数或进程无 `getuid` 时 fail-closed（`credential_source_permissions`）。

## 错误处理

| 情形 | 行为 |
|---|---|
| 凭据根缺失 / 五个账号都无 auth.json | fleet-worker start 500 `orchestrator_credential_home_unavailable`，不 spawn，槽位释放 |
| 某账号文件缺失 | loader `credential_source_unavailable` → issue 原样上抛 → attempt 失败原因可查 |
| 属主不可信 / 组或他人可写 / 符号链接 | `credential_source_permissions` |
| `CECELIA_CREDENTIAL_TRUSTED_UIDS` 含非整数 | `credential_trusted_uids_invalid`（fail-loud） |
| env 未设（CI、us-vps 容器、Brain） | 回退 `os.homedir()`、trustedUids=[]，行为与现状一致 |
| JSON 非法 / 无 access_token | 仍 `credential_payload_invalid`，不泄露字节 |

## 测试策略（TDD，先红后绿）

- **unit** `credential-broker.test.js`：issue 透传 `credential_source_unavailable`/`_permissions`；非 credential_ 错误仍 payload_invalid；loader：0644 属主为进程 uid 通过；注入 fstat uid≠getuid 且不在 trusted → permissions，在 trusted → 通过；0o660/0o622 → permissions；父目录他人可写 → permissions；trustedUids 非法 → `credential_trusted_uids_invalid`。既有 `0o640 → reject` 用例改为 `0o660`（组可写）。
- **unit** `provider-account-home.test.js`：env 未设/空串/相对路径回退 homedir；绝对路径生效；codex/claude/grok；`parseTrustedUids`。
- **unit** `orchestrator-runner.test.cjs`：spawn env 含两变量与 `CECELIA_SKILLS_ROOT`，runner 路径走 `CECELIA_ORCHESTRATOR_RUNNER_ROOT`；probe 抛错 → start 500 且未 spawn、job 释放。
- **GP 步骤断言** `tests/gp/f1/step3-kernel-credential-source.test.js`：真 import broker 与 provider-account-home（不 mock），临时目录 0644 文件经 env 根走通 issue；env 未设时错误为 `credential_source_unavailable` 而非 payload_invalid。
- **环境守卫**：M4 的 start 探测（运行时 fail-loud）；部署后真验：MMV 新派 kernel run 不再出现 `credential_payload_invalid`。

## 部署接缝

合并后 MMV：`runner-checkout` 更新到含修复的 main；fleet-worker 安装副本更新 `orchestrator-runner.cjs`（含回填热修）并 `launchctl kickstart -k`。两者须同一提交。

## 不做

复制凭据到 `_cecelia` 私有目录；改刷新脚本权限（6378efbf）；watchdog 在容器内 resume codex（d7585e60）；kernel_process_fatal 回队/告警（26251eb3）。
