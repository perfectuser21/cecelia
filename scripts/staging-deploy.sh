#!/usr/bin/env bash
# 独立 staging 入口，与生产发布持有相同锁；无 Docker/镜像/验证均失败关闭。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/brain-staging.sh"
[[ "${1:-}" != --dry-run ]] || { echo 'dry-run 不构成 staging 验收'; exit 1; }
command -v docker >/dev/null
brain_release_lock
if [[ "${1:-}" == --cleanup ]]; then
    stage_remove_container cecelia-admission-brain
    stage_remove_container cecelia-admission-db
    stage_remove_network
    # 只消费原stage显式绑定的票据；不扫目录、不按现存tag追认所有权。
    binding=$(node - "$ROOT_DIR/logs/brain-staging-receipt.json" "$ROOT_DIR/logs" <<'NODE'
const fs=require('fs'),path=require('path');try{
if(!fs.existsSync(process.argv[2]))process.exit(0);
const d=JSON.parse(fs.readFileSync(process.argv[2]));
if(!d||typeof d!=='object'||Array.isArray(d))throw Error('receipt invalid');
if(!Object.hasOwn(d,'candidate_ownership_file')||d.candidate_ownership_file==='')process.exit(0);
const p=d.candidate_ownership_file;
if(typeof p!=='string'||!path.isAbsolute(p)||path.dirname(p)!==path.resolve(process.argv[3])||!/^brain-candidate-[a-f0-9-]{36}\.json$/.test(path.basename(p))||!/^sha256:[a-f0-9]{64}$/.test(d.image_id)||!/^([a-f0-9]{40})$/.test(d.sha))throw Error('binding invalid');
if(fs.existsSync(p)){const st=fs.lstatSync(p),o=JSON.parse(fs.readFileSync(p));if(st.isSymbolicLink()||!st.isFile()||o.sha!==d.sha||o.image!==d.image_id)throw Error('ownership mismatch');}
console.log([p,d.sha,d.image_id].join('\n'));
}catch(e){console.error('候选所有权绑定未知，保留：'+e.message);process.exit(1)}
NODE
    ) || exit 1
    if [[ -n "$binding" ]]; then
        BRAIN_CANDIDATE_OWNERSHIP_FILE=$(printf '%s\n' "$binding" | sed -n '1p')
        candidate_image_cleanup "$(printf '%s\n' "$binding" | sed -n '2p')" "$(printf '%s\n' "$binding" | sed -n '3p')" || { echo '候选副本未确认回收，保留原票据与绑定' >&2; exit 1; }
        [[ ! -f "$BRAIN_CANDIDATE_OWNERSHIP_FILE" ]] || { echo '候选副本因共享或未知被保留，保留原绑定' >&2; exit 1; }
    else
        echo '无候选镜像所有权绑定，保留历史镜像'
    fi
    rm -f "$ROOT_DIR/logs/brain-staging-receipt.json"
    exit 0
fi
EXPECTED_SHA="${EXPECTED_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
VERSION=$(git -C "$ROOT_DIR" show "$EXPECTED_SHA:packages/brain/package.json" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
export EXPECTED_SHA
export BRAIN_CANDIDATE_OWNERSHIP_FILE="$ROOT_DIR/logs/brain-candidate-$(node -e 'process.stdout.write(require("crypto").randomUUID())').json"
trap 'status=$?; candidate_image_cleanup "${EXPECTED_SHA:-}" "${image:-}" || echo "候选副本未回收，保留检查" >&2; exit "$status"' EXIT
bash "$SCRIPT_DIR/brain-build.sh"
image=$(docker image inspect --format '{{.Id}}' "cecelia-brain:$VERSION")
stage_candidate "$EXPECTED_SHA" "$image" "$VERSION"
