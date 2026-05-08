# Hotfix: cecelia-run.sh 容器内跳过 sudo 切 user

**日期**: 2026-05-08
**触发**: brain 容器内调 cecelia-run.sh 触发 sudo not found，capability-probe 失败 → cecelia-run breaker 周期 OPEN
**类型**: P0 hotfix（生产 tick scheduler 周期被 breaker 卡）

---

## 背景与实证

`cecelia-run.sh` line 21-32 的 root → administrator 切换段在 brain 容器内出错：

```
$ docker exec cecelia-node-brain bash /Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh
[cecelia-run] 检测到 root 运行，切换到 administrator 重新执行...
/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh: line 31: exec: sudo: not found
```

**实证症状**：
- reset cecelia-run breaker 后 5-15 分钟攒 18-56 failures 又 OPEN
- tick scheduler 因 breaker OPEN 拒绝 dispatch (`{"dispatched":false,"reason":"circuit_breaker_open"}`)
- capability-probe alert 反复刷 P0 通知（被 muted 不发飞书但 log 满）

## 候选方案

### 方案 A：if 条件加 `[ ! -f /.dockerenv ]` + `command -v sudo` ★ 推荐
最小侵入，1 行 if 条件加几个 `&&`，宿主行为 100% 不变。

```bash
if [[ "$(id -u)" == "0" ]] && [[ ! -f /.dockerenv ]] && command -v sudo >/dev/null 2>&1; then
```

- **优点**：最小侵入；双重 detect（容器标记文件 + sudo 实存）；宿主行为完全不变
- **缺点**：无

### 方案 B：完全删 sudo 切换段
脚本始终以 root（容器）或 originating user 跑。

- **优点**：再简单一行
- **缺点**：宿主上 cron 等场景以 root 触发时业务逻辑期待是 administrator user — 删了会 break 宿主语义

### 方案 C：把 sudo 切换包成函数，捕获错误降级
exec sudo 包 try/catch 失败就继续以 root。

- **优点**：bash trap 可以做
- **缺点**：bash 没有真正的 try/catch；exec 后失败处理复杂；改动比方案 A 多

**选 A**：双重 detect 防御 + 宿主行为不变 + 1 行 if 改动。

---

## 设计

### 改动单元

**仅 1 个文件**：`packages/brain/scripts/cecelia-run.sh` (line 21-32)

```diff
-# 如果以 root 运行，重新以 administrator 身份执行（claude 拒绝 root + setsid 下的 --dangerously-skip-permissions）
-if [[ "$(id -u)" == "0" ]]; then
+# 如果以 root 运行（仅宿主环境），重新以 administrator 身份执行（claude 拒绝 root）
+# 容器内（/.dockerenv 存在 OR 没装 sudo）跳过切换：直接以 root 跑，brain 容器本就 root + 不需切 user
+if [[ "$(id -u)" == "0" ]] && [[ ! -f /.dockerenv ]] && command -v sudo >/dev/null 2>&1; then
   echo "[cecelia-run] 检测到 root 运行，切换到 administrator 重新执行..." >&2
   _env_args=()
   for _var in $(compgen -v 2>/dev/null | grep -E '^(CECELIA_|WEBHOOK_URL|WORKTREE_BASE|REPO_ROOT|LOCK_DIR|MAX_CONCURRENT)'); do
     _env_args+=("$_var=${!_var}")
   done
   exec sudo -u administrator env HOME=/Users/administrator PATH="$PATH" "${_env_args[@]+${_env_args[@]}}" "$0" "$@"
 fi
```

### 4 个分支行为表

| 环境 | id -u | /.dockerenv | sudo 存在 | 旧行为 | 新行为 |
|---|---|---|---|---|---|
| 宿主 root | 0 | 不存在 | 是 | 切 admin | 切 admin（不变）✓ |
| 宿主非 root（用户登录） | ≠ 0 | 不存在 | 是 | 不进 if | 不进 if（不变）✓ |
| 容器 root | 0 | **存在** | 否 | exec sudo fail | **跳过，直接以 root 继续** ✓ |
| 容器内有 sudo（理论场景） | 0 | 存在 | 是 | 切 admin（fail，无 admin user） | **跳过（/.dockerenv 兜底）**✓ |

### 错误处理

- 改动是纯条件判断，无新错误路径
- exec sudo 不会再被错误调用
- 旧的 stderr "sudo: not found" 错误信息消失 → capability-probe dispatch 不再失败

---

## 测试策略（dev skill 测试金字塔分类）

| 测试类型 | 目标 | 文件 |
|---|---|---|
| **Behavior (shell wrapper test)** | 4 个分支用 wrapper script mock id/sudo/.dockerenv → 验证条件判断走对路径 | `packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh` |
| **Smoke (E2E)** | 真起的 brain 容器内 docker exec 跑 cecelia-run.sh → 不报 sudo not found，exit ≠ 127 | `packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh` |

**Behavior test 思路**（无 bats/shunit2）：
- 写一个 `.test.sh` script
- 创建 fake `/tmp/test-cecelia-run-mock-XXX/.dockerenv` + 写 wrapper PATH 让 sudo 命令缺失
- source cecelia-run.sh 内核逻辑（或包成函数）
- 验证条件判断结果

**Smoke test 思路**：
- `docker exec cecelia-node-brain bash -c 'CECELIA_TASK_ID=smoke-test /Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh --dry-run' 2>&1`
- grep 不含 "sudo: not found"
- exit code 不是 127

---

## Version bump

- `packages/brain/package.json` + `package-lock.json`：1.228.5 → 1.228.6

---

## 不做（明确范围）

- 不动 cecelia-run.sh 别的地方（line 31 之外）
- 不修 capability-probe 的 dispatch 探针（修 root cause 不修探针）
- 不动 docker-compose.yml 任何 env
- 不删 sudo 切换段（方案 B/C 拒绝）
- 不引入 git-style 容器 detect helper（小改不重构）

---

## 验证（PR 合并 + brain redeploy 后）

1. reset cecelia-run breaker 一次后等 30 分钟
2. 期待 `circuit_breaker_states` cecelia-run 仍 CLOSED + failures < 5
3. 期待 brain log 不再有 "sudo: not found" 报错
4. 期待 tick API `dispatched=true`（不再 reason=circuit_breaker_open）

---

## 关联

- 上一轮 PR #2837：propose_branch SKILL/fallback 双修
- 上一轮 PR #2838：inferTaskPlan 加 git fetch
- 本 PR 修：cecelia-run.sh 容器 detect
- 长治 sprint：[Cecelia Harness Pipeline Journey](https://www.notion.so/Cecelia-Harness-Pipeline-35ac40c2ba6381dba6fbf0c3cb4f1ad4) 6 thin features 实现，从根本规范容器内/外环境差异
