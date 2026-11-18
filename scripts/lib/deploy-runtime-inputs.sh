#!/usr/bin/env bash
# 专用发布根在Git切换期间保护运行输入；失败证据只保存在该根的.runtime。
deploy_runtime_inputs_backup() {
    local root="$1"
    HOST_DISK_SAMPLE="$root/.runtime/host-disk.json"
    HOST_DISK_BACKUP=""
    WORKERS_CONFIG_INPUT="$root/packages/workflows/staff/workers.config.json"
    WORKERS_CONFIG_BACKUP=""
    WORKERS_CONFIG_MODE=""
    if [[ -f "$HOST_DISK_SAMPLE" ]]; then
        if ! HOST_DISK_BACKUP=$(mktemp "$root/.runtime/.host-disk-deploy-XXXXXX"); then
            echo '❌ 部署根守卫: 宿主磁盘采样备份失败，拒绝覆盖' >&2
            return 1
        fi
        if ! cp "$HOST_DISK_SAMPLE" "$HOST_DISK_BACKUP"; then
            rm -f "$HOST_DISK_BACKUP"
            echo '❌ 部署根守卫: 宿主磁盘采样备份失败，拒绝覆盖' >&2
            return 1
        fi
    fi
    if [[ -f "$WORKERS_CONFIG_INPUT" ]]; then
        if ! WORKERS_CONFIG_MODE=$(stat -c '%a' "$WORKERS_CONFIG_INPUT" 2>/dev/null || stat -f '%Lp' "$WORKERS_CONFIG_INPUT"); then
            echo '❌ 部署根守卫: 运行时worker配置备份失败，无法读取权限' >&2
            return 1
        fi
        [[ "$WORKERS_CONFIG_MODE" =~ ^[0-7]{3,4}$ ]] || return 1
        if ! mkdir -p "$root/.runtime" || ! WORKERS_CONFIG_BACKUP=$(mktemp "$root/.runtime/.workers-config-deploy-XXXXXX"); then
            echo '❌ 部署根守卫: 运行时worker配置备份失败，拒绝覆盖' >&2
            return 1
        fi
        if ! cp "$WORKERS_CONFIG_INPUT" "$WORKERS_CONFIG_BACKUP"; then
            rm -f "$WORKERS_CONFIG_BACKUP"
            echo '❌ 部署根守卫: 运行时worker配置备份失败，拒绝覆盖' >&2
            return 1
        fi
    fi
}

deploy_restore_host_disk_sample() {
    if [[ -n "$HOST_DISK_BACKUP" ]]; then
        if ! mv -f "$HOST_DISK_BACKUP" "$HOST_DISK_SAMPLE"; then
            rm -f "$HOST_DISK_SAMPLE" || true
            echo "❌ 部署根守卫: 宿主磁盘采样恢复失败，拒绝部署；原样备份保留在 $HOST_DISK_BACKUP" >&2
            return 1
        fi
        HOST_DISK_BACKUP=""
        echo '✅ 宿主磁盘采样已恢复（宿主 cron 继续更新）'
    elif [[ -f "$HOST_DISK_SAMPLE" ]] \
        && git -C "$MAIN_ROOT" ls-files --error-unmatch -- .runtime/host-disk.json >/dev/null 2>&1 \
        && git -C "$MAIN_ROOT" diff --quiet -- .runtime/host-disk.json; then
        # 没有实际宿主采样时，Git历史值不能冒充容量真值。
        if ! rm -f "$HOST_DISK_SAMPLE"; then
            echo '❌ 部署根守卫: 无法清除Git历史磁盘样本，拒绝部署' >&2
            return 1
        fi
    fi
}

deploy_restore_workers_config() {
    local staged=""
    [[ -n "$WORKERS_CONFIG_BACKUP" ]] || return 0
    # 恢复用独立临时文件；成功前保留600权限原始备份，不把失败的Git默认值当实际配置。
    if mkdir -p "$(dirname "$WORKERS_CONFIG_INPUT")" \
        && staged=$(mktemp "$(dirname "$WORKERS_CONFIG_INPUT")/.workers-config-restore-XXXXXX") \
        && cp "$WORKERS_CONFIG_BACKUP" "$staged" \
        && chmod "$WORKERS_CONFIG_MODE" "$staged" \
        && mv -f "$staged" "$WORKERS_CONFIG_INPUT"; then
        rm -f "$WORKERS_CONFIG_BACKUP" || return 1
        WORKERS_CONFIG_BACKUP=""
        echo '✅ 运行时worker配置已恢复（原始字节与权限）'
    else
        [[ -z "$staged" ]] || rm -f "$staged" || true
        echo "❌ 部署根守卫: 运行时worker配置恢复失败，拒绝部署；原始备份保留在 $WORKERS_CONFIG_BACKUP（权限 $WORKERS_CONFIG_MODE）" >&2
        return 1
    fi
}

deploy_runtime_inputs_restore() {
    local failed=0
    # 某项恢复失败不能阻止另一项恢复。
    deploy_restore_host_disk_sample || failed=1
    deploy_restore_workers_config || failed=1
    return "$failed"
}
