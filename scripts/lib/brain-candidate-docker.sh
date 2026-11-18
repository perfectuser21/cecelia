#!/usr/bin/env bash
# 候选可借用可信 SSH Docker context；不修改默认 daemon 或全局 Docker 环境。
# US生产Brain容器只有SSH挂载，没有宿主context元数据；首次旧webhook拉取新main时也适用。
# 显式context优先；显式空HOST仍允许测试/独立宿主选择本地daemon。
if [[ "${ENV_REGION:-}" == us && -f /.dockerenv && -z "${BRAIN_CANDIDATE_DOCKER_CONTEXT:-}" && -z "${BRAIN_CANDIDATE_DOCKER_HOST+x}" ]]; then
    export BRAIN_CANDIDATE_DOCKER_HOST=ssh://administrator@100.71.151.105
fi
candidate_docker() {
    local context="${BRAIN_CANDIDATE_DOCKER_CONTEXT:-}" endpoint="${BRAIN_CANDIDATE_DOCKER_HOST:-}"
    if [[ -z "$context" ]]; then
        if [[ -n "$endpoint" ]]; then
            [[ "$endpoint" =~ ^ssh://[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+(:[0-9]+)?$ ]] || { echo '候选 Docker 端点必须使用固定 SSH 主机' >&2; return 1; }
            docker --host "$endpoint" "$@"
        else
            docker "$@"
        fi
        return
    fi
    [[ "$context" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo '非法候选 Docker context' >&2; return 1; }
    endpoint=$(docker context inspect "$context" --format '{{.Endpoints.docker.Host}}') || return 1
    [[ "$endpoint" == ssh://?* ]] || { echo '候选 Docker context 必须使用 SSH' >&2; return 1; }
    docker --context "$context" "$@"
}

# 同一不可变镜像在构建端与生产端都必须通过身份/平台校验。
candidate_verify_image() {
    local executor="$1" image="$2" sha="$3" actual
    [[ "$image" =~ ^sha256:[a-f0-9]{64}$ && "$sha" =~ ^[a-f0-9]{40}$ ]] || return 1
    actual=$("$executor" image inspect --format '{{.Id}}' "$image") || return 1
    [[ "$actual" == "$image" ]] || { echo '候选镜像 ID 不符' >&2; return 1; }
    actual=$("$executor" image inspect --format '{{.Os}}/{{.Architecture}}' "$image") || return 1
    [[ "$actual" == linux/amd64 ]] || { echo '候选镜像必须为 linux/amd64' >&2; return 1; }
    actual=$("$executor" image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image") || return 1
    actual=$(printf '%s\n' "$actual" | sed -n 's/^GIT_SHA=//p')
    [[ "$actual" == "$sha" ]] || { echo '候选镜像 SHA 不符' >&2; return 1; }
}
