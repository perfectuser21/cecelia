#!/usr/bin/env bash
# 完成部署身份和manifest验真后，才同步宿主执行器/Bridge并运行既有smoke。
# ── Post-deploy smoke 函数 ──────────────────────────────────────────────────
# 部署 healthy 之后跑最近合并 PR 引入的 packages/brain/scripts/smoke/*.sh，
# 验生产 Brain 真生效（不只 200/healthy）。
#
# 控制 env：
#   SKIP_POST_DEPLOY_SMOKE=1  整体跳过（紧急部署 / 离线场景）
#   RECENT_PRS="2651 2650"    强制指定 PR 列表，绕过 gh pr list（测试用 / mock）
#
# 退出码：始终 0（每条 smoke non-fatal — deploy 已成功不能因 smoke 回滚）。
run_post_deploy_smoke() {
    if [[ "${SKIP_POST_DEPLOY_SMOKE:-0}" == "1" ]]; then
        echo "  [skip] SKIP_POST_DEPLOY_SMOKE=1"
        return 0
    fi
    if ! command -v gh >/dev/null 2>&1 && [[ -z "${RECENT_PRS:-}" ]]; then
        echo "  [skip] gh CLI 不存在且未提供 RECENT_PRS 覆盖 — 跳过 smoke 扫描"
        return 0
    fi

    local recent_prs="${RECENT_PRS:-}"
    if [[ -z "$recent_prs" ]]; then
        recent_prs=$(gh pr list --state merged --limit 5 --json number --jq '.[].number' 2>/dev/null || echo "")
    fi
    if [[ -z "$recent_prs" ]]; then
        echo "  没找到最近合并 PR — 跳过"
        return 0
    fi

    local ran=0 failed=0 sf
    # 去重缓存（避免同一 smoke 在多 PR 都改过时跑多次）— 用临时文件兼容老 bash
    local seen_file
    seen_file=$(mktemp "${TMPDIR:-/tmp}/post_deploy_smoke_seen.XXXXXX")
    # shellcheck disable=SC2064
    trap "rm -f '$seen_file'" RETURN

    for pr in $recent_prs; do
        local smoke_files=""
        if command -v gh >/dev/null 2>&1; then
            smoke_files=$(gh pr view "$pr" --json files --jq '.files[] | select(.path | startswith("packages/brain/scripts/smoke/") and endswith(".sh")) | .path' 2>/dev/null || echo "")
        fi
        # mock 模式：用户直接指定 RECENT_PRS 但没 gh，回退扫本地 worktree
        if [[ -z "$smoke_files" && -n "${RECENT_PRS:-}" && -d "$ROOT_DIR/packages/brain/scripts/smoke" ]]; then
            smoke_files=$(find "$ROOT_DIR/packages/brain/scripts/smoke" -maxdepth 1 -name "*.sh" -type f -print 2>/dev/null | sed "s|$ROOT_DIR/||")
        fi
        for sf in $smoke_files; do
            if grep -qxF "$sf" "$seen_file" 2>/dev/null; then continue; fi
            echo "$sf" >> "$seen_file"
            if [[ ! -f "$ROOT_DIR/$sf" ]]; then
                echo "  [skip] $sf (PR #$pr 引入但本地 worktree 不存在)"
                continue
            fi
            ran=$((ran + 1))
            echo "  Running $sf (from PR #$pr)..."
            if bash "$ROOT_DIR/$sf"; then
                echo "  ✅ smoke pass: $sf"
            else
                echo "  ❌ smoke failed: $sf (non-fatal — deploy 已成功)"
                failed=$((failed + 1))
            fi
        done
    done
    if [[ "$ran" -eq 0 ]]; then
        echo "  最近 5 个合并 PR 未引入 smoke.sh — 跳过"
    else
        echo "  Post-deploy smoke 总计：跑 $ran 条，失败 $failed 条"
    fi
    return 0
}

complete_verified_host_release() {
    # 8. Update cecelia-run on host (self-update: keeps executor in sync with repo)
    echo ""
    echo "[8/10] Updating cecelia-run on host..."
    CECELIA_RUN_SRC="$ROOT_DIR/packages/brain/scripts/cecelia-run.sh"
    CECELIA_RUN_DST="${HOST_HOME}/bin/cecelia-run"
    if [[ -f "$CECELIA_RUN_SRC" ]]; then
      # macOS cp identical files 返 rc=1，set -e 会中止后续 Phase 9-10；|| true 兜底
      cp "$CECELIA_RUN_SRC" "$CECELIA_RUN_DST" 2>&1 || true
      chmod +x "$CECELIA_RUN_DST" 2>/dev/null || true
      echo "  Updated $CECELIA_RUN_DST (v${VERSION})"
    else
      echo "  WARN: $CECELIA_RUN_SRC not found, skipping cecelia-run update"
    fi

    # 9. Update cecelia-bridge on host (self-update: keeps bridge timeout config in sync)
    echo ""
    echo "[9/10] Updating cecelia-bridge on host..."
    BRIDGE_SRC="$ROOT_DIR/packages/brain/scripts/cecelia-bridge.js"
    BRIDGE_DST="${HOST_HOME}/bin/cecelia-bridge.js"
    if [[ -f "$BRIDGE_SRC" ]]; then
      # Bridge文件未落地不算部署成功；复制异常时EXIT回执必须保留failed。
      DEPLOY_SUCCESS=false
      # 入口依赖先到位再更新入口，避免宿主bin首次部署缺模块导致Bridge起不来。
      BRIDGE_LIB_SRC="$ROOT_DIR/packages/brain/scripts/lib/bridge-lifecycle.cjs"
      BRIDGE_LIB_DIR="${HOST_HOME}/bin/lib"
      mkdir -p "$BRIDGE_LIB_DIR"
      if ! cmp -s "$BRIDGE_LIB_SRC" "$BRIDGE_LIB_DIR/bridge-lifecycle.cjs"; then
        cp "$BRIDGE_LIB_SRC" "$BRIDGE_LIB_DIR/bridge-lifecycle.cjs"
      fi
      # 内容一致时不cp；真正的权限/磁盘错误必须让set -e终止，不能吞掉。
      if ! cmp -s "$BRIDGE_SRC" "$BRIDGE_DST"; then
        cp "$BRIDGE_SRC" "$BRIDGE_DST"
      fi
      DEPLOY_SUCCESS=true
      echo "  Updated $BRIDGE_DST (v${VERSION})"
      # 重启 bridge：按自身服务管理方式，与 Brain 的 Docker 发布模式无关。
      BRIDGE_SERVICE="com.cecelia.bridge"
      BRIDGE_PLIST="${HOME}/Library/LaunchAgents/${BRIDGE_SERVICE}.plist"
      if [[ "$(uname -s)" == Darwin && -f "$BRIDGE_PLIST" ]]; then
        launchctl kickstart -k "gui/$(id -u)/${BRIDGE_SERVICE}" 2>/dev/null && \
          echo "  Bridge restarted via launchd" || \
          echo "  NOTE: Bridge launchd restart skipped (service may not be running)"
      elif systemctl is-active cecelia-bridge >/dev/null 2>&1; then
        if command -v sudo >/dev/null 2>&1; then
          SUDO_CMD="sudo -n"
          if $SUDO_CMD sed -i "s|ExecStart=.*cecelia-bridge.*|ExecStart=/usr/bin/node $BRIDGE_DST|" /etc/systemd/system/cecelia-bridge.service 2>/dev/null && \
             $SUDO_CMD systemctl daemon-reload 2>/dev/null && \
             $SUDO_CMD systemctl restart cecelia-bridge 2>/dev/null; then
            echo "  Bridge restarted via systemd (now using $BRIDGE_DST)"
          else
            echo "  NOTE: sudo unavailable. Bridge will use updated file on next manual restart."
          fi
        fi
      fi
    else
      echo "  WARN: $BRIDGE_SRC not found, skipping bridge update"
    fi

    echo ""
    echo "[10/10] Post-deploy smoke..."
    run_post_deploy_smoke || true   # smoke non-fatal — deploy 已成功

}
