#!/usr/bin/env bash
# warroom-data-api-smoke.sh
# 验证 3 个只读端点（handoffs / sentinel/health / decisions/recent）
# 在 Brain 运行时：curl 真调；离线时：node 语法验证降级通过
set -e

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "warroom-data-api smoke — $BRAIN_URL"

# 语法 / 模块可导入检查（CI 离线下保证代码无语法错误）
node --input-type=module <<'JS'
import('/workspace/packages/brain/src/routes/warroom-data.js')
  .then(() => process.stdout.write('OK: warroom-data.js importable\n'))
  .catch((e) => { process.stderr.write('FAIL: ' + e.message + '\n'); process.exit(1); });
JS

# 路由挂载检查（warroom-data 已在 routes.js import 列表里）
grep -q "warroom-data" /workspace/packages/brain/src/routes.js \
  && echo "OK: warroom-data imported in routes.js" \
  || { echo "FAIL: warroom-data not found in routes.js"; exit 1; }

# 三端点路径定义检查
node -e "
const fs = require('fs');
const src = fs.readFileSync('/workspace/packages/brain/src/routes/warroom-data.js','utf8');
['/handoffs','/sentinel/health','/decisions/recent'].forEach(path => {
  if (!src.includes(path)) { console.error('FAIL: missing route', path); process.exit(1); }
  console.log('OK: route', path, 'defined');
});
"

# 在线验证（Brain 可达时真调 API）
if curl -sf --max-time 3 "${BRAIN_URL}/api/brain/health" >/dev/null 2>&1; then
  echo "Brain is running — running live checks"

  curl -sf --max-time 5 "${BRAIN_URL}/api/brain/handoffs?limit=1" \
    | node -e "const d=require('fs').readFileSync(0,'utf8'); const j=JSON.parse(d); if(!('success' in j)) throw new Error('missing success'); console.log('OK: /handoffs →', JSON.stringify({success:j.success,total:j.total}))"

  curl -sf --max-time 5 "${BRAIN_URL}/api/brain/sentinel/health" \
    | node -e "const d=require('fs').readFileSync(0,'utf8'); const j=JSON.parse(d); if(!j.data||!('healthy' in j.data)) throw new Error('missing healthy'); console.log('OK: /sentinel/health →', JSON.stringify({healthy:j.data.healthy,expected:j.data.expected}))"

  curl -sf --max-time 5 "${BRAIN_URL}/api/brain/decisions/recent?limit=1" \
    | node -e "const d=require('fs').readFileSync(0,'utf8'); const j=JSON.parse(d); if(!('success' in j)) throw new Error('missing success'); console.log('OK: /decisions/recent →', JSON.stringify({success:j.success,total:j.total}))"
else
  echo "Brain not reachable — skipping live checks (CI offline)"
fi

echo "warroom-data-api smoke passed"
