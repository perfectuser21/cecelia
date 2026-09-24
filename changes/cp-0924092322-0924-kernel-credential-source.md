## Brain {VERSION} — kernel-v1 远程 run 凭据来源修复（credential_payload_invalid 根治）

- `credential-broker`：`issue` 透传 loader 的 `credential_*` 错误码（仅 JSON 非法才 `credential_payload_invalid`）；loader 增 `trustedUids`（属主 ∈ 进程 uid ∪ 可信 uid，非整数/无 getuid 且声明 trusted → fail-closed）、权限规则改为「可读、无组/他人写、无执行位」、校验父目录（目录/非符号链接/属主可信/无组他人写）
- 新模块 `orchestrator/provider-account-home.js`：账号目录名单一真身；`resolveProviderAccountHome`（执行目录，homedir）与 `resolveCredentialAccountHome`（凭据目录，`CECELIA_CREDENTIAL_HOME_ROOT`，非绝对路径 fail-loud）分离；`parseTrustedUids`（uint32、带片段错误）；run.js / harness-relay-watchdog 的凭据 loader 接线
- fleet-worker `orchestrator-runner`：start 前探测 `CECELIA_ORBSTACK_HOME` 下 codex 账号 auth.json 存在性（失败 500 `orchestrator_credential_home_unavailable`，run 置 failed 释放槽位），spawn env 注入 `CECELIA_CREDENTIAL_HOME_ROOT` / `CECELIA_CREDENTIAL_TRUSTED_UIDS`；回填 09-20 生产热修（runner/skills 路径走 `CECELIA_ORCHESTRATOR_RUNNER_ROOT`）
- GP 守卫 `tests/gp/f1/step3-kernel-credential-source.test.js`（任务 d3764629，决策 fbe2146c）
