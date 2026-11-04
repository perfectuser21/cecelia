#!/usr/bin/env bash
# 固定Git候选的版本门：源码变更必须已升版。碎片没有现役消费者，不能代替升版。
# BASE_REF默认origin/main，HEAD_REF默认HEAD；CI必须传实际事件的BASE/HEAD。
set -euo pipefail
BASE_REF="${BASE_REF:-origin/main}"
HEAD_REF="${HEAD_REF:-HEAD}"
BASE_SHA=$(git rev-parse --verify --end-of-options "${BASE_REF}^{commit}") || { echo '::error::无法读取版本基线commit' >&2; exit 1; }
HEAD_SHA=$(git rev-parse --verify --end-of-options "${HEAD_REF}^{commit}") || { echo '::error::无法读取版本候选commit' >&2; exit 1; }
# 让Git按路径范围直接判定；不解析会被quotePath转义的文件名，跨边界rename也算变更。
if git diff --quiet --no-ext-diff --no-textconv "${BASE_SHA}...${HEAD_SHA}" -- packages/brain/src/; then
  echo '跳过版本检查：本次diff不含packages/brain/src/**变更（skip）'
  exit 0
else
  diff_status=$?
  if [[ "$diff_status" != 1 ]]; then
    echo "::error::无法比较版本候选（git diff exit=${diff_status}）" >&2
    exit 1
  fi
fi
BRAIN_PKG='packages/brain/package.json'
BASE_PKG=$(git show "${BASE_SHA}:${BRAIN_PKG}") || { echo '::error::版本基线缺少Brain package' >&2; exit 1; }
HEAD_PKG=$(git show "${HEAD_SHA}:${BRAIN_PKG}") || { echo '::error::版本候选缺少Brain package' >&2; exit 1; }
BASE_VERSION=$(printf '%s' "$BASE_PKG" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
HEAD_VERSION=$(printf '%s' "$HEAD_PKG" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
if node -e '
  const [head,base]=process.argv.slice(1), pattern=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  if(!pattern.test(head)||!pattern.test(base))process.exit(1);
  const a=head.split(".").map(BigInt),b=base.split(".").map(BigInt);
  for(let i=0;i<3;i++){if(a[i]>b[i])process.exit(0);if(a[i]<b[i])process.exit(1);}
  process.exit(1);
' "$HEAD_VERSION" "$BASE_VERSION"; then
  echo "✅ 版本已 bump：${BASE_VERSION} → ${HEAD_VERSION}（${HEAD_SHA}）"
  exit 0
fi
echo "::error::brain src 有变更但版本未 bump或格式非法（base=${BASE_VERSION}，PR=${HEAD_VERSION}）" >&2
echo '请由实现阶段修复候选：同步更新Brain package、嵌套lock、根workspace lock、.brain-versions及DEFINITION版本，并重新验收。' >&2
echo 'changes/碎片不能替代真实版本增量；publish不会在验收后改写候选。' >&2
exit 1
