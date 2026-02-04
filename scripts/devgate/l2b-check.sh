#!/usr/bin/env bash
set -euo pipefail

# L2B Evidence Check
# 支持两种模式：pr（L2B-min）和 release（L2B-full）

MODE="${1:-pr}"
EVIDENCE_FILE=".layer2-evidence.md"

echo "==> L2B Evidence Check (mode: $MODE)"

# 检查文件存在
if [[ ! -f "$EVIDENCE_FILE" ]]; then
  echo "❌ 缺少 $EVIDENCE_FILE"
  echo "提示: 创建该文件记录可复核证据（手动验证、自动化测试、截图等）"
  exit 1
fi

# 检查文件不为空
if [[ ! -s "$EVIDENCE_FILE" ]]; then
  echo "❌ $EVIDENCE_FILE 为空"
  exit 1
fi

# 检查必需字段
REQUIRED_SECTIONS=(
  "## 手动验证"
  "## 自动化测试"
)

for section in "${REQUIRED_SECTIONS[@]}"; do
  if ! grep -qF "$section" "$EVIDENCE_FILE"; then
    echo "❌ 缺少必需章节: $section"
    exit 1
  fi
done

# L2B-min: 至少 1 条可复核证据
if [[ "$MODE" == "pr" ]]; then
  # P1-1: 增强检查 - 可复现性验证（拒绝纯文字描述）
  # 1. 必须有可复现命令或机器引用
  # 2. 如果有 commit SHA，验证是否匹配当前 HEAD
  # 3. 如果有 CI run ID，验证格式合理性
  # 4. 检查截图文件必须存在且非空（新增）

  HAS_COMMAND=false
  HAS_MACHINE_REF=false

  echo ""
  echo "  [P1-1: 可复现性验证]"

  # 检查可复现命令（在代码块内或列表项中）
  # H2 FIX: 使用单词边界避免匹配 "rebash"
  # P1-1 增强: 扩展命令列表，包含 curl, docker, make 等
  if grep -qE '(\bnpm\s+run\b|\bbash\b|\bnode\b|\bgit\b|\bpytest\b|\bcargo\b|\bgo\s+test\b|\bcurl\b|\bdocker\b|\bmake\b)' "$EVIDENCE_FILE"; then
    HAS_COMMAND=true
    echo "  ✅ 检测到可复现命令"
  fi

  # 检查机器引用（SHA、run ID、hash 等）
  # H3 FIX: 使用单词边界和更严格的模式
  if grep -qE '(\b[0-9a-f]{7,40}\b|run[_-]?id:\s*[0-9]+|#[0-9]+|\bsha256:[0-9a-f]+)' "$EVIDENCE_FILE"; then
    HAS_MACHINE_REF=true
    echo "  ✅ 检测到机器引用"
  fi

  # P1-1 增强: 严格要求至少一种可复现证据
  if [[ "$HAS_COMMAND" == "false" && "$HAS_MACHINE_REF" == "false" ]]; then
    echo "  ❌ Evidence 必须包含可复现证据，不接受纯文字描述"
    echo ""
    echo "  要求（至少满足一项）："
    echo "    1. 可复现命令："
    echo "       - npm run test"
    echo "       - bash scripts/check.sh"
    echo "       - curl -X POST http://..."
    echo ""
    echo "    2. 机器引用："
    echo "       - CI run ID: 12345"
    echo "       - Commit SHA: abc123f"
    echo "       - File hash: sha256:..."
    echo ""
    echo "  禁止："
    echo "    ❌ \"测试通过\""
    echo "    ❌ \"功能正常\""
    echo "    ❌ \"手动验证无问题\""
    exit 1
  fi

  # P1-1 增强: 验证截图文件存在且非空
  SCREENSHOT_REFS=$(grep -oP 'docs/evidence/[^)\s]+\.(png|jpg|jpeg|gif)' "$EVIDENCE_FILE" || echo "")
  if [[ -n "$SCREENSHOT_REFS" ]]; then
    echo "  [验证截图文件]"
    MISSING_SCREENSHOTS=()
    EMPTY_SCREENSHOTS=()

    while IFS= read -r file; do
      if [[ ! -f "$file" ]]; then
        MISSING_SCREENSHOTS+=("$file")
      elif [[ ! -s "$file" ]]; then
        EMPTY_SCREENSHOTS+=("$file")
      fi
    done <<< "$SCREENSHOT_REFS"

    if [[ ${#MISSING_SCREENSHOTS[@]} -gt 0 ]]; then
      echo "  ❌ 引用的截图文件不存在:"
      for file in "${MISSING_SCREENSHOTS[@]}"; do
        echo "     - $file"
      done
      exit 1
    fi

    if [[ ${#EMPTY_SCREENSHOTS[@]} -gt 0 ]]; then
      echo "  ❌ 引用的截图文件为空:"
      for file in "${EMPTY_SCREENSHOTS[@]}"; do
        echo "     - $file"
      done
      exit 1
    fi

    echo "  ✅ 所有截图文件存在且非空 ($(echo "$SCREENSHOT_REFS" | wc -l) files)"
  fi

  # P1: 验证 commit SHA 真实性（如果存在）
  CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
  CURRENT_HEAD_SHORT=$(git rev-parse --short HEAD 2>/dev/null || echo "")

  # 提取证据中的 SHA (7-40 位)
  EVIDENCE_SHAS=$(grep -oE '\b[0-9a-f]{7,40}\b' "$EVIDENCE_FILE" || echo "")

  if [[ -n "$EVIDENCE_SHAS" && -n "$CURRENT_HEAD" ]]; then
    echo ""
    echo "  [验证 commit SHA]"
    SHA_VALID=false
    while IFS= read -r sha; do
      # C2 FIX: 双向前缀匹配，支持短SHA匹配长HEAD
      # 检查是否匹配当前 HEAD (完整或短格式，双向前缀)
      if [[ "$sha" == "$CURRENT_HEAD" ]] || \
         [[ "$sha" == "$CURRENT_HEAD_SHORT"* ]] || \
         [[ "$CURRENT_HEAD" == "$sha"* ]] || \
         [[ "$CURRENT_HEAD_SHORT" == "$sha"* ]]; then
        echo "  ✅ SHA $sha 匹配当前 HEAD"
        SHA_VALID=true
        break
      fi
      # 检查是否是历史提交（在当前分支）
      if git cat-file -e "$sha" 2>/dev/null && git merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
        echo "  ✅ SHA $sha 是当前分支的历史提交"
        SHA_VALID=true
        break
      fi
    done <<< "$EVIDENCE_SHAS"

    if [[ "$SHA_VALID" == "false" ]]; then
      echo "  ❌ 证据中的 SHA 不匹配当前 HEAD 或历史提交"
      echo "     这可能是复制粘贴的假证据"
      # L3 FIX: 显示所有 SHA，不只是第一个
      echo "     证据中的 SHA:"
      while IFS= read -r sha; do
        echo "       - $sha"
      done <<< "$EVIDENCE_SHAS"
      echo "     当前 HEAD: $CURRENT_HEAD_SHORT"
      # L5 FIX: 从警告改为阻断模式，防止伪造证据
      exit 1
    fi
  fi

  # 简单检查：至少有一个列表项或代码块
  if ! grep -qE '^- |^```' "$EVIDENCE_FILE"; then
    echo "❌ 至少需要 1 条可复核证据（列表项或代码块）"
    exit 1
  fi

  echo "✅ L2B-min 检查通过 (command=$HAS_COMMAND, machine_ref=$HAS_MACHINE_REF)"
fi

# P2: Evidence 时间戳验证
echo ""
echo "  [P2: Evidence 时间戳验证]"
if [[ -f "$EVIDENCE_FILE" ]]; then
  EVIDENCE_MTIME=$(stat -c %Y "$EVIDENCE_FILE" 2>/dev/null || stat -f %m "$EVIDENCE_FILE" 2>/dev/null || echo "0")
  COMMIT_TIME=$(git show -s --format=%ct HEAD 2>/dev/null || echo "0")

  if [[ "$EVIDENCE_MTIME" -gt 0 && "$COMMIT_TIME" -gt 0 ]]; then
    # Bug fix: Evidence 时间戳检查逻辑修正
    # Evidence 必须在 commit 同时或之后生成（允许5分钟=300秒误差用于 CI 延迟）
    # 原逻辑错误：允许 evidence 比 commit 早 5 分钟，应该是晚 5 分钟
    if [[ $EVIDENCE_MTIME -lt $COMMIT_TIME ]]; then
      # Evidence 比 commit 更早，可能是伪造（复用旧 evidence）
      TIME_DIFF=$((COMMIT_TIME - EVIDENCE_MTIME))
      if [[ $TIME_DIFF -gt 300 ]]; then
        echo "  ❌ Evidence 时间戳过旧，可能是伪造"
        echo "     Evidence mtime: $(date -d @$EVIDENCE_MTIME 2>/dev/null || date -r $EVIDENCE_MTIME 2>/dev/null)"
        echo "     Commit time:    $(date -d @$COMMIT_TIME 2>/dev/null || date -r $COMMIT_TIME 2>/dev/null)"
        echo "     差值: ${TIME_DIFF}秒（超过允许的300秒误差）"
        echo "     这可能是复用旧 commit 的证据"
        exit 1
      fi
    fi
    echo "  ✅ Evidence 时间戳有效"
  else
    echo "  ⚠️  无法获取时间戳，跳过验证"
  fi
fi

# P2: Evidence 文件存在性验证
echo ""
echo "  [P2: Evidence 文件存在性验证]"
EVIDENCE_FILES=$(grep -oP 'docs/evidence/[^)\s]+' "$EVIDENCE_FILE" 2>/dev/null || echo "")
if [[ -n "$EVIDENCE_FILES" ]]; then
  MISSING_FILES=()
  while IFS= read -r file; do
    if [[ -n "$file" && ! -f "$file" ]]; then
      MISSING_FILES+=("$file")
    fi
  done <<< "$EVIDENCE_FILES"

  if [[ ${#MISSING_FILES[@]} -gt 0 ]]; then
    echo "  ❌ Evidence 引用的文件不存在:"
    for file in "${MISSING_FILES[@]}"; do
      echo "     - $file"
    done
    exit 1
  fi
  echo "  ✅ 所有引用的 evidence 文件都存在 ($(echo "$EVIDENCE_FILES" | wc -l) files)"
else
  echo "  ℹ️  无 docs/evidence/ 文件引用"
fi

# P2: Evidence Metadata 验证
echo ""
echo "  [P2: Evidence Metadata 验证]"
if head -n 10 "$EVIDENCE_FILE" | grep -q '^---$'; then
  echo "  ℹ️  检测到 YAML frontmatter"

  # 提取 frontmatter（第一个 --- 到第二个 ---）
  FRONTMATTER=$(awk '/^---$/{if(++n==2)exit;next}n==1' "$EVIDENCE_FILE")

  # 检查必填字段
  REQUIRED_FIELDS=("commit" "timestamp")
  MISSING_FIELDS=()

  for field in "${REQUIRED_FIELDS[@]}"; do
    if ! echo "$FRONTMATTER" | grep -qE "^${field}:"; then
      MISSING_FIELDS+=("$field")
    fi
  done

  if [[ ${#MISSING_FIELDS[@]} -gt 0 ]]; then
    echo "  ❌ Evidence metadata 缺少必填字段:"
    for field in "${MISSING_FIELDS[@]}"; do
      echo "     - $field"
    done
    echo ""
    echo "  提示: 在 Evidence 文件开头添加 YAML frontmatter:"
    echo "  ---"
    echo "  commit: \$(git rev-parse HEAD)"
    echo "  timestamp: \$(date -u +%Y-%m-%dT%H:%M:%S+00:00)"
    echo "  ci_run_id: \${{ github.run_id }}  # 可选，CI 中自动注入"
    echo "  ---"
    exit 1
  fi

  echo "  ✅ Evidence metadata 完整"
else
  echo "  ⚠️  无 YAML frontmatter（推荐添加以增强可追溯性）"
fi

# L2B-full: 完整证据 + DoD 全勾
if [[ "$MODE" == "release" ]]; then
  # 检查 DoD 引用
  if ! grep -qF "## DoD 完成度" "$EVIDENCE_FILE"; then
    echo "❌ Release 模式需要 '## DoD 完成度' 章节"
    exit 1
  fi
  
  # 检查是否有未完成项（[ ]）
  # L2 FIX: 支持多空格的 checkbox（[\s*]）
  if grep -qE '^\- \[\s*\]' "$EVIDENCE_FILE"; then
    echo "❌ 存在未完成的 DoD 项"
    exit 1
  fi
  
  echo "✅ L2B-full 检查通过"
fi

exit 0
