#!/bin/bash
set -e

# ============================================================================
# Merge Exploratory PRD/DOD Documents
# ============================================================================
# 合并多个 exploratory 产出的 PRD/DOD 文件，用于大 Initiative 场景
#
# 使用方式：
#   bash scripts/merge-exploratory-docs.sh exploratory-*.prd.md exploratory-*.dod.md
#   bash scripts/merge-exploratory-docs.sh --output auth-system exploratory-*.{prd,dod}.md
#
# 功能：
#   1. 解析所有 PRD 和 DOD 文件
#   2. 提取关键信息（需求、方案、依赖、踩坑）
#   3. 智能合并成完整的系统级 PRD/DOD
#   4. 生成结构化输出
# ============================================================================

OUTPUT_PREFIX="merged"
PRD_FILES=()
DOD_FILES=()
VERBOSE=false

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 显示帮助
show_help() {
  cat << HELP
使用方式：
  $0 [OPTIONS] FILES...

OPTIONS:
  --output <prefix>   输出文件前缀（默认：merged）
  --verbose           显示详细信息
  --help              显示此帮助信息

FILES:
  *.prd.md            PRD 文件
  *.dod.md            DOD 文件

示例：
  # 合并所有 exploratory 产出
  $0 exploratory-*.prd.md exploratory-*.dod.md

  # 指定输出前缀
  $0 --output auth-system exploratory-login.{prd,dod}.md exploratory-signup.{prd,dod}.md

  # 详细模式
  $0 --verbose --output user-mgmt exploratory-*.{prd,dod}.md
HELP
}

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_PREFIX="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *.prd.md)
      PRD_FILES+=("$1")
      shift
      ;;
    *.dod.md)
      DOD_FILES+=("$1")
      shift
      ;;
    *)
      echo -e "${RED}❌ 未知参数: $1${NC}"
      echo ""
      show_help
      exit 1
      ;;
  esac
done

# 验证输入
if [ ${#PRD_FILES[@]} -eq 0 ] && [ ${#DOD_FILES[@]} -eq 0 ]; then
  echo -e "${RED}❌ 错误：至少需要一个 PRD 或 DOD 文件${NC}"
  echo ""
  show_help
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${BLUE}合并 Exploratory 文档${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "输出前缀: $OUTPUT_PREFIX"
echo "PRD 文件: ${#PRD_FILES[@]}"
echo "DOD 文件: ${#DOD_FILES[@]}"
echo ""

# 合并 PRD 文件
if [ ${#PRD_FILES[@]} -gt 0 ]; then
  echo -e "${BLUE}📄 合并 ${#PRD_FILES[@]} 个 PRD 文件...${NC}"
  
  # 创建临时文件存储合并内容
  MERGED_PRD_CONTENT=""
  
  # 读取所有 PRD 文件
  for prd in "${PRD_FILES[@]}"; do
    if [ ! -f "$prd" ]; then
      echo -e "${YELLOW}⚠️  文件不存在: $prd${NC}"
      continue
    fi
    
    [ "$VERBOSE" = true ] && echo "  读取: $prd"
    
    # 提取文件名（去掉路径和扩展名）
    BASENAME=$(basename "$prd" .prd.md)
    
    # 追加到合并内容
    MERGED_PRD_CONTENT+="

## 来源：$BASENAME

$(cat "$prd")

---

"
  done
  
  # 生成合并后的 PRD
  cat > "${OUTPUT_PREFIX}.prd.md" << PRDDOC
---
title: ${OUTPUT_PREFIX} - 合并 PRD
version: 1.0.0
created: $(date +%Y-%m-%d)
source: Merged from ${#PRD_FILES[@]} exploratory PRDs
---

# PRD: ${OUTPUT_PREFIX}

## 概述

本文档基于 ${#PRD_FILES[@]} 个 Exploratory 任务的 PRD 合并而成。

### 源文件

$(for prd in "${PRD_FILES[@]}"; do echo "- $(basename "$prd")"; done)

## 1. 背景与目标

### 整体目标
通过多个独立的 Exploratory 验证，确认以下功能可行并已实现原型：

$(for prd in "${PRD_FILES[@]}"; do
  BASENAME=$(basename "$prd" .prd.md)
  echo "- **$BASENAME**: $(grep -m1 "^#" "$prd" | sed 's/^#* *//' || echo "功能验证")"
done)

## 2. 功能需求（合并）

$MERGED_PRD_CONTENT

## 3. 技术方案总结

### 整体架构

基于上述各个 Exploratory 任务的验证，整体技术方案如下：

- 各模块独立验证，功能已跑通
- 需要在正式实现时统一架构和接口
- 注意处理模块间的依赖关系

### 依赖关系

$(for prd in "${PRD_FILES[@]}"; do
  if grep -q "依赖\|Dependency\|Dependencies" "$prd"; then
    BASENAME=$(basename "$prd" .prd.md)
    echo ""
    echo "**$BASENAME**:"
    grep -A5 "依赖\|Dependency\|Dependencies" "$prd" | head -6 || echo "  - 无特殊依赖"
  fi
done)

### 踩坑记录

$(for prd in "${PRD_FILES[@]}"; do
  if grep -q "踩坑\|问题\|Issue\|Problem" "$prd"; then
    BASENAME=$(basename "$prd" .prd.md)
    echo ""
    echo "**$BASENAME**:"
    grep -A3 "踩坑\|问题\|Issue\|Problem" "$prd" | head -4 || echo "  - 无记录"
  fi
done)

## 4. 实现建议

### 实施顺序

建议按以下顺序实现各模块：

$(i=1; for prd in "${PRD_FILES[@]}"; do
  BASENAME=$(basename "$prd" .prd.md)
  echo "$i. $BASENAME"
  i=$((i+1))
done)

### 注意事项

1. **统一接口**: 各模块在 Exploratory 中可能使用不同接口，实施时需统一
2. **代码质量**: Exploratory 代码是快速验证版本，正式实现需要重写
3. **测试覆盖**: 每个模块都需要完整的单元测试和集成测试
4. **文档完整**: 补充 API 文档、使用说明、部署文档

## 5. 验收标准

参见合并后的 DOD 文件：${OUTPUT_PREFIX}.dod.md

## 附录：原始 PRD 文件

$(for prd in "${PRD_FILES[@]}"; do
  echo "- $prd"
done)
PRDDOC
  
  echo -e "${GREEN}✅ PRD 合并完成: ${OUTPUT_PREFIX}.prd.md${NC}"
fi

# 合并 DOD 文件
if [ ${#DOD_FILES[@]} -gt 0 ]; then
  echo ""
  echo -e "${BLUE}📋 合并 ${#DOD_FILES[@]} 个 DOD 文件...${NC}"
  
  # 创建临时文件存储合并内容
  MERGED_DOD_CONTENT=""
  
  # 读取所有 DOD 文件
  for dod in "${DOD_FILES[@]}"; do
    if [ ! -f "$dod" ]; then
      echo -e "${YELLOW}⚠️  文件不存在: $dod${NC}"
      continue
    fi
    
    [ "$VERBOSE" = true ] && echo "  读取: $dod"
    
    # 提取文件名
    BASENAME=$(basename "$dod" .dod.md)
    
    # 追加到合并内容
    MERGED_DOD_CONTENT+="

## 模块：$BASENAME

$(cat "$dod")

---

"
  done
  
  # 生成合并后的 DOD
  cat > "${OUTPUT_PREFIX}.dod.md" << DODDOC
# Definition of Done - ${OUTPUT_PREFIX}

## 概述

本 DOD 基于 ${#DOD_FILES[@]} 个 Exploratory 任务的 DOD 合并而成。

### 源文件

$(for dod in "${DOD_FILES[@]}"; do echo "- $(basename "$dod")"; done)

## 整体验收标准

### 1. 功能完整性

所有子模块功能必须完整实现：

$(i=1; for dod in "${DOD_FILES[@]}"; do
  BASENAME=$(basename "$dod" .dod.md)
  echo "$i. **$BASENAME**: 功能正常工作"
  i=$((i+1))
done)

### 2. 集成测试

- [ ] 所有模块单独测试通过
- [ ] 模块间集成测试通过
- [ ] 端到端测试通过
- [ ] 性能测试达标

### 3. 代码质量

- [ ] 所有代码通过 lint 检查
- [ ] 测试覆盖率 >= 80%
- [ ] 所有 PR review 通过
- [ ] CI/CD 全部通过

### 4. 文档完整

- [ ] API 文档完整
- [ ] 使用说明清晰
- [ ] 部署文档齐全
- [ ] CHANGELOG 更新

## 各模块验收标准（详细）

$MERGED_DOD_CONTENT

## 最终检查清单

- [ ] 所有子模块 DOD 满足
- [ ] 整体集成测试通过
- [ ] 文档审查完成
- [ ] 生产环境部署成功

## 附录：原始 DOD 文件

$(for dod in "${DOD_FILES[@]}"; do
  echo "- $dod"
done)
DODDOC
  
  echo -e "${GREEN}✅ DOD 合并完成: ${OUTPUT_PREFIX}.dod.md${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✅ 合并完成${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "产出文件："
[ ${#PRD_FILES[@]} -gt 0 ] && echo "  📄 ${OUTPUT_PREFIX}.prd.md"
[ ${#DOD_FILES[@]} -gt 0 ] && echo "  📋 ${OUTPUT_PREFIX}.dod.md"
echo ""
echo "下一步："
echo "  1. 审查合并后的文档，确认内容完整"
echo "  2. 手动调整需要统一的部分（接口、命名等）"
echo "  3. 使用 /dev 基于合并后的 PRD/DOD 开始正式开发"
echo ""
