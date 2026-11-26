#!/usr/bin/env bash
# 快照仅驻留本次隔离数据库的匿名数据卷；不得写宿主文件系统。
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
const reserve=2n*BigInt(e)+5368709120n,available=1024n*BigInt(k),budget=available-reserve;
if(reserve>max||available>max||budget<=0n)process.exit(1);
process.stdout.write(`${reserve} ${budget}`);
NODE
}
stage_snapshot_restore() {
    local estimated available budget
    phase=disk-budget
    estimated=$(docker exec cecelia-node-brain node --input-type=module -e '
      const {default:pg}=await import("pg");const {DB_DEFAULTS}=await import("./src/db-config.js");
      const c=new pg.Client(DB_DEFAULTS);await c.connect();
      try { const r=await c.query("SELECT pg_database_size(current_database())::text AS bytes");process.stdout.write(r.rows[0].bytes); }finally{await c.end();}
    ')
    available=$(candidate_docker exec "$db" df -Pk /var/lib/postgresql/data | awk 'NR==2 {print $4}')
    budget=$(stage_snapshot_budget "$estimated" "$available") || { echo 'Docker盘不足以安全恢复候选快照或容量非法' >&2; return 1; }
    read -r snapshot_reserve snapshot_limit <<< "$budget"
    snapshot_container=$(candidate_docker inspect "$db" --format '{{.Id}}')
    [[ "$snapshot_container" =~ ^[a-f0-9]{64}$ ]] || return 1
    stage_snapshot_identity
    snapshot_dir=$(candidate_docker exec "$snapshot_container" sh -ec '
      umask 077
      test -d /var/lib/postgresql/data && test ! -L /var/lib/postgresql/data || exit 1
      mktemp -d "/var/lib/postgresql/data/cecelia-snapshot-$1.XXXXXXXX"
    ' snapshot-create "$request_id")
    [[ "$snapshot_dir" == "/var/lib/postgresql/data/cecelia-snapshot-$request_id."* && "$snapshot_dir" =~ ^/var/lib/postgresql/data/cecelia-snapshot-[a-f0-9-]{36}\.[a-zA-Z0-9]+$ ]] || return 1
    phase=snapshot-spool
    stage_timing_begin export_transfer
    stage_snapshot_identity
    # 同一次完整快照；receiver成功不代表producer成功，父shell的pipefail成功后才提交归档。
    docker exec cecelia-node-brain sh -ec '
      test "$DB_NAME" = cecelia
      export PGPASSWORD="$DB_PASSWORD"
      exec pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-acl --compress=gzip:1
    ' | candidate_docker exec -i "$snapshot_container" sh -ec '
      umask 077
      case "$2" in ""|*[!0-9]*|0) exit 1;; esac
      test -d "$1" && test ! -L "$1" && test "$(stat -c %a "$1")" = 700 && test "$(stat -c %u "$1")" = "$(id -u)" || exit 1
      test ! -e "$1/archive.part" && test ! -L "$1/archive.part" || exit 1
      set -C
      head -c "$2" > "$1/archive.part"
    ' snapshot-receive "$snapshot_dir" "$snapshot_limit"
    stage_snapshot_identity
    snapshot_bytes=$(candidate_docker exec "$snapshot_container" sh -ec '
      test -d "$1" && test ! -L "$1" && test "$(stat -c %a "$1")" = 700 && test "$(stat -c %u "$1")" = "$(id -u)" || exit 1
      test -f "$1/archive.part" && test ! -L "$1/archive.part" || exit 1
      test "$(stat -c %a "$1/archive.part")" = 600 && test "$(stat -c %u "$1/archive.part")" = "$(id -u)" || exit 1
      bytes=$(wc -c < "$1/archive.part")
      bytes=$(printf "%s" "$bytes" | tr -d "[:space:]")
      case "$bytes" in ""|*[!0-9]*) exit 1;; esac
      test "$bytes" -gt 0 && test "$bytes" -lt "$2" || exit 1
      test ! -e "$1/archive" && test ! -L "$1/archive" || exit 1
      mv "$1/archive.part" "$1/archive"
      printf "%s" "$bytes"
    ' snapshot-commit "$snapshot_dir" "$snapshot_limit")
    [[ "$snapshot_bytes" =~ ^[1-9][0-9]*$ ]] || return 1
    stage_timing_end
    available=$(candidate_docker exec "$snapshot_container" df -Pk "$snapshot_dir" | awk 'NR==2 {print $4}')
    # 同一文件系统重新检查，严格保留原恢复余量。
    stage_snapshot_budget "$estimated" "$available" >/dev/null || return 1
    echo "[staging] request=$request_id sha=$sha snapshot_bytes=$snapshot_bytes jobs=2"
    phase=snapshot-restore
    stage_timing_begin restore
    stage_snapshot_identity
    candidate_docker exec "$snapshot_container" pg_restore -h 127.0.0.1 --exit-on-error --no-owner --no-acl -U cecelia -d cecelia_staging --jobs=2 "$snapshot_dir/archive"
    stage_timing_end
    # 敏感归档清理闭锁迁移；失败由原请求的rm-v回收本次数据卷。
    phase=snapshot-cleanup
    stage_timing_begin cleanup
    stage_snapshot_identity
    candidate_docker exec "$snapshot_container" sh -ec '
      test -d "$1" && test ! -L "$1" || exit 1
      test -f "$1/archive" && test ! -L "$1/archive" || exit 1
      rm "$1/archive"
      rmdir "$1"
      test ! -e "$1" && test ! -L "$1" || exit 1
    ' snapshot-cleanup "$snapshot_dir"
    stage_timing_end
}
