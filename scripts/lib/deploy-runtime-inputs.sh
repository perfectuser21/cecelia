#!/usr/bin/env bash
# 专用发布根在Git切换期间保护运行输入；失败证据只保存在该根的.runtime。
deploy_runtime_inputs_backup() {
    local root="$1"
    WORKERS_CONFIG_INPUT="$root/packages/workflows/staff/workers.config.json"
    WORKERS_CONFIG_BACKUP=""
    WORKERS_CONFIG_MODE=""
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
        # BusyBox cp可把现有mktemp文件权限改成源权限，显式收紧后才允许Git变更。
        if ! chmod 600 "$WORKERS_CONFIG_BACKUP"; then
            echo "❌ 部署根守卫: 运行时worker配置备份权限设置失败，拒绝覆盖；原始证据保留在 ${WORKERS_CONFIG_BACKUP}" >&2
            return 1
        fi
    fi
}

deploy_workers_config_matches_backup() {
    local current_mode
    [[ -f "$WORKERS_CONFIG_INPUT" && ! -L "$WORKERS_CONFIG_INPUT" ]] \
        && cmp -s "$WORKERS_CONFIG_BACKUP" "$WORKERS_CONFIG_INPUT" \
        && current_mode=$(stat -c '%a' "$WORKERS_CONFIG_INPUT" 2>/dev/null || stat -f '%Lp' "$WORKERS_CONFIG_INPUT") \
        && [[ "$current_mode" == "$WORKERS_CONFIG_MODE" ]]
}

deploy_restore_workers_config() {
    local staged=""
    [[ -n "$WORKERS_CONFIG_BACKUP" ]] || return 0
    if [[ -L "$WORKERS_CONFIG_INPUT" || ( -e "$WORKERS_CONFIG_INPUT" && ! -f "$WORKERS_CONFIG_INPUT" ) ]]; then
        echo "❌ 部署根守卫: 运行时worker配置恢复失败，目的路径不是普通文件；原始备份保留在 ${WORKERS_CONFIG_BACKUP}" >&2
        return 1
    fi
    if deploy_workers_config_matches_backup; then
        if ! rm -f "$WORKERS_CONFIG_BACKUP"; then
            echo "❌ 部署根守卫: 运行时worker配置备份清理失败，拒绝部署；原始备份保留在 ${WORKERS_CONFIG_BACKUP}" >&2
            return 1
        fi
        WORKERS_CONFIG_BACKUP=""
        echo '✅ 运行时worker配置已恢复（原始字节与权限一致，无需替换）'
        return 0
    fi
    # 恢复用独立临时文件；成功前保留600权限原始备份，不把失败的Git默认值当实际配置。
    if mkdir -p "$(dirname "$WORKERS_CONFIG_INPUT")" \
        && staged=$(mktemp "$(dirname "$WORKERS_CONFIG_INPUT")/.workers-config-restore-XXXXXX") \
        && cp "$WORKERS_CONFIG_BACKUP" "$staged" \
        && chmod "$WORKERS_CONFIG_MODE" "$staged" \
        && mv -f "$staged" "$WORKERS_CONFIG_INPUT" \
        && deploy_workers_config_matches_backup; then
        rm -f "$WORKERS_CONFIG_BACKUP" || return 1
        WORKERS_CONFIG_BACKUP=""
        echo '✅ 运行时worker配置已恢复（原始字节与权限）'
    else
        [[ -z "$staged" ]] || rm -f "$staged" || true
        echo "❌ 部署根守卫: 运行时worker配置恢复失败，拒绝部署；原始备份保留在 ${WORKERS_CONFIG_BACKUP}（权限 ${WORKERS_CONFIG_MODE}）" >&2
        return 1
    fi
}

deploy_runtime_inputs_restore() {
    local failed=0
    deploy_restore_workers_config || failed=1
    return "$failed"
}
