# PRD: CI 硬化第二批 — BEHAVIOR 动态命令真执行

## 背景

Repo-audit 发现"CI 最虚的一刀"：`.github/workflows/ci.yml:221` 里的 DoD BEHAVIOR 命令执行步骤显式跳过了 `curl / chrome: / psql / bash / npm` 这五类命令，只跑 `node` 命令。

```bash
elif [[ "$CMD" == curl* ]] || [[ "$CMD" == chrome:* ]] || [[ "$CMD" == psql* ]] || [[ "$CMD" == bash* ]] || [[ "$CMD" == npm* ]]; then
  echo "⏭️  跳过（需要运行时服务）: ${CMD%% *} ..."
  SKIPPED=$((SKIPPED + 1))
```

后果：DoD 里声称的"API 可达性、DB 状态、服务行为"等动态验证，CI 从来没真跑过。写 DoD 的人以为自己设了门槛，CI 只是 echo "跳过"。

同时发现第二个 bug：TASK_CARD 扫描用的是老命名 `.task-*.md / task-card.md`，当前 /dev 标准 `DoD.md` 不在扫描列表，所以这步对大部分 PR 根本没触发过。与 cleanup regex bug 同源（命名约定改过，脚本没跟改）。

## 成功标准

1. 新增 `dod-behavior-dynamic` CI job，带 postgres service + Brain 5221 spin-up + 等 `/api/brain/health`
2. 新 job 执行 DoD 里 `Test: manual:curl/psql/bash/npm` 类型的命令 — 不再跳过
3. chrome: 仍跳过（需 headful browser）
4. TASK_CARD 扫描加入 `DoD.md`（主）；保留 `.task-*.md / task-card.md`（兼容）
5. `dod-behavior-dynamic` 纳入 `ci-passed` needs + check 列表
6. 早退机制：DoD 无动态命令时，新 job 不启动 Brain（省 postgres 开销）
7. 本 PR 自带一条 curl 动态测试作为 dogfood（验新 job 能真跑通）

## 非目标（YAGNI）

- 不碰 engine-tests 里原 "DoD BEHAVIOR 命令执行" 步骤（它继续负责 node 快速路径，与新 job 分工）
- 不改 chrome: 跳过逻辑（需 headful，暂无刚需）
- 不改 DoD 格式（向后兼容）
- 不重写 Brain startup（复用 brain-integration 同款 postgres service 配置）

## 分工

| Job | 跑什么 | 需要服务 | 速度 |
|-----|-------|---------|-----|
| engine-tests (旧) | `node` + `tests/` | 无 | 快 |
| dod-behavior-dynamic (新) | `curl` / `psql` / `bash` / `npm` | postgres + Brain | 慢（Brain 需 ~10-30s 起） |
