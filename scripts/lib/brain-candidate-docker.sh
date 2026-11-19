#!/usr/bin/env bash
# 候选可借用可信 SSH Docker context；不修改默认 daemon 或全局 Docker 环境。
# US生产Brain容器只有SSH挂载，没有宿主context元数据；首次旧webhook拉取新main时也适用。
# 显式context优先；显式空HOST仍允许测试/独立宿主选择本地daemon。
if [[ "${ENV_REGION:-}" == us && -f /.dockerenv && -z "${BRAIN_CANDIDATE_DOCKER_CONTEXT:-}" && -z "${BRAIN_CANDIDATE_DOCKER_HOST+x}" ]]; then
    export BRAIN_CANDIDATE_DOCKER_HOST=ssh://administrator@100.71.151.105
fi
# 回收边界每条CLI有界；失联不能让EXIT清理长期阻塞或伪装查询成功。
candidate_docker_cli() {
    if [[ "${CANDIDATE_GC_BOUNDED:-false}" != true ]]; then docker "$@"; return; fi
    node - "$@" <<'NODE'
const {spawnSync}=require('child_process');
const r=spawnSync('docker',process.argv.slice(2),{encoding:'utf8',timeout:15000,maxBuffer:16*1024*1024});
if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
if(r.error)console.error('候选回收CLI未确认：'+r.error.message);
process.exit(r.status??1);
NODE
}
candidate_docker() {
    local context="${BRAIN_CANDIDATE_DOCKER_CONTEXT:-}" endpoint="${BRAIN_CANDIDATE_DOCKER_HOST:-}"
    if [[ -z "$context" ]]; then
        if [[ -n "$endpoint" ]]; then
            [[ "$endpoint" =~ ^ssh://[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+(:[0-9]+)?$ ]] || { echo '候选 Docker 端点必须使用固定 SSH 主机' >&2; return 1; }
            candidate_docker_cli --host "$endpoint" "$@"
        else
            candidate_docker_cli "$@"
        fi
        return
    fi
    [[ "$context" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo '非法候选 Docker context' >&2; return 1; }
    endpoint=$(candidate_docker_cli context inspect "$context" --format '{{.Endpoints.docker.Host}}') || return 1
    [[ "$endpoint" == ssh://?* ]] || { echo '候选 Docker context 必须使用 SSH' >&2; return 1; }
    candidate_docker_cli --context "$context" "$@"
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

# 构建前落本人票据：不从历史候选tag/验收回执追认所有权。
candidate_image_prepare() {
    local file="$1" tag="$2" sha="$3" candidate production inventory
    local CANDIDATE_GC_BOUNDED=true
    candidate=$(candidate_docker info --format '{{.ID}}') || return 1
    production=$(candidate_docker_cli info --format '{{.ID}}') || return 1
    inventory=$(candidate_docker image ls --all --quiet --no-trunc) || return 1
    CANDIDATE_INVENTORY="$inventory" node - "$file" "$tag" "$sha" "$candidate" "$production" <<'NODE'
const fs=require('fs'),[file,tag,sha,candidate,production]=process.argv.slice(2);
const ids=process.env.CANDIDATE_INVENTORY.split(/\s+/).filter(Boolean);
if(!candidate.trim()||!production.trim()||ids.some(id=>!/^sha256:[a-f0-9]{64}$/.test(id)))process.exit(1);
fs.writeFileSync(file,JSON.stringify({schema:1,tag,sha,candidate,production,preexisting:ids}),{flag:'wx',mode:0o600});
NODE
}

# 可证明为本次独占的跨机副本才回收；任何未知均保留，绝不force/prune。
candidate_image_cleanup() {
    local file="${BRAIN_CANDIDATE_OWNERSHIP_FILE:-}" expected_sha="${1:-}" expected_image="${2:-}"
    local CANDIDATE_GC_BOUNDED=true
    local fields tag sha candidate production metadata target containers container referenced actual_candidate actual_production
    [[ -n "$file" && -f "$file" ]] || return 0
    fields=$(node - "$file" "$expected_sha" <<'NODE'
const fs=require('fs');try{const d=JSON.parse(fs.readFileSync(process.argv[2]));
if(d.delete_attempted){console.error('候选副本保留：此前删除结果未确认，不重发');process.exit(1);}
if(d.schema!==1||!/^cecelia-brain:candidate-[a-f0-9]{40}-[a-f0-9-]{36}$/.test(d.tag)||!/^([a-f0-9]{40})$/.test(d.sha)||!Array.isArray(d.preexisting)||d.preexisting.some(x=>!/^sha256:[a-f0-9]{64}$/.test(x))||!d.candidate||!d.production||(process.argv[3]&&d.sha!==process.argv[3]))process.exit(1);
console.log([d.tag,d.sha,d.candidate,d.production].join('\n'));}catch{process.exit(1)}
NODE
    ) || return 1
    tag=$(printf '%s\n' "$fields" | sed -n '1p'); sha=$(printf '%s\n' "$fields" | sed -n '2p')
    candidate=$(printf '%s\n' "$fields" | sed -n '3p'); production=$(printf '%s\n' "$fields" | sed -n '4p')
    [[ "$candidate" != "$production" ]] || { echo "候选副本保留：构建与生产为同一daemon" >&2; return 0; }
    actual_candidate=$(candidate_docker info --format '{{.ID}}') || return 1
    actual_production=$(candidate_docker_cli info --format '{{.ID}}') || return 1
    [[ "$actual_candidate" == "$candidate" && "$actual_production" == "$production" ]] || { echo '候选副本保留：daemon身份已变化' >&2; return 1; }
    metadata=$(candidate_docker image inspect --format '{{json .}}' "$tag") || return 1
    target=$(CANDIDATE_METADATA="$metadata" node - "$file" "$expected_image" <<'NODE'
const fs=require('fs');try{const d=JSON.parse(fs.readFileSync(process.argv[2])),m=JSON.parse(process.env.CANDIDATE_METADATA);
if(!/^sha256:[a-f0-9]{64}$/.test(m.Id)||d.preexisting.includes(m.Id)||(d.image&&d.image!==m.Id)||(process.argv[3]&&m.Id!==process.argv[3])||!Array.isArray(m.RepoTags)||m.RepoTags.length!==1||m.RepoTags[0]!==d.tag||!Array.isArray(m.RepoDigests)||m.RepoDigests.length||!m.Config?.Env?.includes('GIT_SHA='+d.sha))process.exit(1);
console.log(m.Id);}catch{process.exit(1)}
NODE
    ) || { echo '候选副本保留：镜像非本次独占或元数据未知' >&2; return 0; }
    containers=$(candidate_docker ps -aq --no-trunc) || return 1
    for container in $containers; do
        referenced=$(candidate_docker inspect "$container" --format '{{.Image}}') || return 1
        [[ "$referenced" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
        [[ "$referenced" != "$target" ]] || { echo "候选副本保留：仍有容器引用" >&2; return 0; }
    done
    actual_candidate=$(candidate_docker info --format '{{.ID}}') || return 1
    actual_production=$(candidate_docker_cli info --format '{{.ID}}') || return 1
    [[ "$actual_candidate" == "$candidate" && "$actual_production" == "$production" ]] || { echo '候选副本保留：daemon身份已变化' >&2; return 1; }
    node - "$file" "$target" <<'NODE'
const fs=require('fs'),p=process.argv[2],d=JSON.parse(fs.readFileSync(p));
if(d.delete_attempted)process.exit(1);
d.delete_attempted=true;d.cleanup_status='delete_unknown';d.delete_target=process.argv[3];
fs.writeFileSync(p+'.cleanup',JSON.stringify(d),{flag:'wx',mode:0o600});fs.renameSync(p+'.cleanup',p);
NODE
    [[ $? == 0 ]] || return 1
    candidate_docker image rm "$target" || { echo '候选副本删除结果未确认：保留票据，不重发' >&2; return 1; }
    rm -f "$file"
}
