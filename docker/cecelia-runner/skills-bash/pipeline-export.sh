#!/usr/bin/env bash
# pipeline-export.sh — Stage 6 NAS 归档机（单命令入口）
#
# 搬运自 docs/pipeline-ops-skills/pipeline-export/SKILL.md，移除 Claude 中间解读步骤。
# 2 步：写 manifest.json -> tar over ssh 传到 NAS。
set -o pipefail
set -u

# ─── 步骤 1：检查产物齐全 ───────────────────────────────────────────
OUT_DIR="${CONTENT_OUTPUT_DIR}"
PID="${CONTENT_PIPELINE_ID}"
CARDS_DIR="$OUT_DIR/cards"

for req in "$CARDS_DIR" "$OUT_DIR/article/article.md" "$OUT_DIR/findings.json"; do
  if [ ! -e "$req" ]; then
    echo "{\"manifest_path\":null,\"nas_url\":null,\"error\":\"missing $req\"}"
    exit 0
  fi
done

echo "[export] out_dir=$OUT_DIR pid=$PID" >&2

# ─── 步骤 2：写 manifest.json ──────────────────────────────────────
MANIFEST="$OUT_DIR/manifest.json"
KEYWORD=$(python3 -c "import json; print(json.load(open('$OUT_DIR/findings.json')).get('keyword',''))")

export CARDS_DIR PID KEYWORD
python3 <<'PYEOF' > "$MANIFEST"
import json, os, glob
from datetime import datetime

cards_dir = os.environ['CARDS_DIR']
cards = sorted(os.path.basename(p) for p in glob.glob(f"{cards_dir}/*.png"))
manifest = {
    "pipeline_id": os.environ['PID'],
    "keyword": os.environ['KEYWORD'],
    "created_at": datetime.now().isoformat(),
    "status": "ready_for_publish",
    "cards": cards,
    "copy": "cards/copy.md",
    "article": "article/article.md",
    "findings": "findings.json",
    "person_data": "person-data.json",
}
print(json.dumps(manifest, ensure_ascii=False, indent=2))
PYEOF

echo "[export] manifest written to $MANIFEST" >&2

# ─── 步骤 3：tar over ssh 传 NAS ───────────────────────────────────
NAS_SSH_ALIAS="${NAS_SSH_ALIAS:-nas}"
NAS_BASE="${NAS_BASE:-/volume1/workspace/vault/zenithjoy-creator/content}"
NAS_DIR="$NAS_BASE/$PID"

# 先在 NAS 建目录
ssh "$NAS_SSH_ALIAS" "mkdir -p '$NAS_DIR'" >&2 2>&1 || true

# tar 打包宿主目录 -> pipe 到 NAS 解压
set +e
cd "$OUT_DIR" && tar -cf - . 2>/dev/null | ssh "$NAS_SSH_ALIAS" "tar -xf - -C '$NAS_DIR'" >&2 2>&1
TAR_EXIT=$?
set -e

if [ "$TAR_EXIT" -ne 0 ]; then
  echo "{\"manifest_path\":\"$MANIFEST\",\"nas_url\":null,\"error\":\"tar/ssh 失败 (exit=${TAR_EXIT})\"}"
  exit 0
fi

# ─── 步骤 4：输出 JSON ──────────────────────────────────────────────
CARDS_COUNT=$(ls "$CARDS_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "{\"manifest_path\":\"$MANIFEST\",\"nas_url\":\"$NAS_DIR\",\"cards_count\":${CARDS_COUNT}}"
