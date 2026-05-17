# PRD: Hotfix — brain-deploy.sh cp identical 中止 Phase 9-11

## 背景

今天部署 Brain v1.226.0 时发现 `brain-deploy.sh` 在 `[8/8] Updating cecelia-run` 之后**直接退出**，Phase 9（cecelia-bridge update）/ Phase 10（Notion sync）/ Phase 11（**post-deploy smoke** —— cicd-C PR #2655 加的）全部不跑。

## 根因

macOS `cp` 命令在源 == 目标（identical files）时返 rc=1：
```bash
$ cp /tmp/x /tmp/x; echo $?
cp: /tmp/x and /tmp/x are identical (not copied).
1
```

`brain-deploy.sh` 顶部 `set -euo pipefail`，rc=1 直接中止。

我之前 cicd-C PR #2655 加 Phase 11 post-deploy smoke 时没察觉这个盲点 —— **post-deploy smoke 写完几天来从未真跑过**（DST file 始终 identical，每次 cp rc=1，脚本秒退）。

## 修复

`scripts/brain-deploy.sh` 两处 cp 加 `|| true` 兜底：

- L344: `cp "$CECELIA_RUN_SRC" "$CECELIA_RUN_DST" 2>&1 || true`
- L357: `cp "$BRIDGE_SRC" "$BRIDGE_DST" 2>&1 || true`

也给 chmod 加 `|| true`（防其他罕见 rc）。

## 验收

- 修后再 deploy → 看到 `[9/9] Updating cecelia-bridge` / `[10/11] Notion sync` / `[11/11] Post-deploy smoke` 三段全跑
- 本地 simulated test: cp identical + `|| true` → Phase 2 到达，rc=0

## 范围

- 改：`scripts/brain-deploy.sh`（2 处 cp + 1 处 chmod）
- 不动 Brain 代码、不 bump 版本（hotfix shell 修复）
