#!/usr/bin/env bash
# 完整快照只走管道；导出、传输与恢复重叠，合并计时。
stage_clock_ms() { node -e 'process.stdout.write(String(process.hrtime.bigint()/1000000n))'; }
stage_timing_begin() { timing_phase="$1"; timing_started=$(stage_clock_ms); }
stage_timing_end() {
    [[ -n "${timing_phase:-}" ]] || return 0
    local ended duration
    ended=$(stage_clock_ms); duration=$((ended-timing_started))
    [[ "$duration" -ge 0 ]] || return 1
    timing_entries="${timing_entries:-}${timing_phase}:${duration},"
    echo "[staging-timing] request=$request_id sha=$sha phase=$timing_phase duration_ms=$duration"
    timing_phase=''
}
stage_snapshot_identity() {
    [[ "$(candidate_docker inspect "$db" --format '{{.Id}}')" == "$snapshot_container" ]] || return 1
    [[ "$(candidate_docker inspect "$db" --format '{{index .Config.Labels "cecelia.staging"}}')" == admission-v1 ]] || return 1
    [[ "$(candidate_docker inspect "$db" --format '{{index .Config.Labels "cecelia.staging.request"}}')" == "$request_id" ]]
}
stage_snapshot_budget() {
    # BigInt防止shell算术溢出；只接受JS安全范围内的十进制非负整数。
    node - "$1" "$2" <<'NODE'
const [e,k]=process.argv.slice(2),max=BigInt(Number.MAX_SAFE_INTEGER);
if(![e,k].every(x=>/^(0|[1-9][0-9]*)$/.test(x)&&BigInt(x)<=max))process.exit(1);
const reserve=2n*BigInt(e)+5368709120n,available=1024n*BigInt(k);
if(reserve>max||available>max||available<=reserve)process.exit(1);
process.stdout.write(String(reserve));
NODE
}
stage_snapshot_restore() {
    local estimated available reserve
    phase=disk-budget
    snapshot_container=$(candidate_docker inspect "$db" --format '{{.Id}}')
    [[ "$snapshot_container" =~ ^[a-f0-9]{64}$ ]] || return 1
    stage_snapshot_identity
    estimated=$(docker exec cecelia-node-brain node --input-type=module -e '
      const {default:pg}=await import("pg");const {DB_DEFAULTS}=await import("./src/db-config.js");
      const c=new pg.Client(DB_DEFAULTS);await c.connect();
      try { const r=await c.query("SELECT pg_database_size(current_database())::text AS bytes");process.stdout.write(r.rows[0].bytes); }finally{await c.end();}
    ')
    available=$(candidate_docker exec "$snapshot_container" df -Pk /var/lib/postgresql/data | awk 'NR==2 {print $4}')
    reserve=$(stage_snapshot_budget "$estimated" "$available") || { echo 'Docker盘不足以安全恢复候选快照或容量非法' >&2; return 1; }
    echo "[staging] request=$request_id sha=$sha database_bytes=$estimated available_kib=$available reserve_bytes=$reserve"
    phase=snapshot-restore
    stage_timing_begin export_transfer_restore
    stage_snapshot_identity
    # 保留一次完整快照与外键；pipefail同时传播producer、传输及restore错误。
    docker exec cecelia-node-brain sh -ec '
      test "$DB_NAME" = cecelia
      export PGPASSWORD="$DB_PASSWORD"
      exec pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-acl --compress=gzip:1
    ' | candidate_docker exec -i "$snapshot_container" pg_restore -h 127.0.0.1 --exit-on-error --no-owner --no-acl -U cecelia -d cecelia_staging
    stage_snapshot_identity
    stage_timing_end
}
