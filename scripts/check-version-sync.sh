#!/usr/bin/env bash
# Check all version files are in sync with packages/brain/package.json
# Adapted from Engine's ci/scripts/check-version-sync.sh for Core

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Version Sync Check (Core)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Base version from packages/brain/package.json (SSOT)
if [[ ! -f "packages/brain/package.json" ]]; then
    echo "⚠️  packages/brain/package.json not found, skipping"
    exit 0
fi

BASE_VERSION=$(jq -r '.version' packages/brain/package.json)
echo "Base version (packages/brain/package.json): $BASE_VERSION"
echo ""

ERRORS=0

# Check packages/brain/package-lock.json
if [[ -f "packages/brain/package-lock.json" ]]; then
    LOCK_VERSION=$(jq -r '.version' packages/brain/package-lock.json)
    if [[ "$LOCK_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ packages/brain/package-lock.json: $LOCK_VERSION (expected: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ packages/brain/package-lock.json: $LOCK_VERSION"
    fi
fi

# Check .brain-versions
if [[ -f ".brain-versions" ]]; then
    BV_VERSION=$(cat .brain-versions | tr -d '\n')
    if [[ "$BV_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ .brain-versions: $BV_VERSION (expected: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ .brain-versions: $BV_VERSION"
    fi
fi

# Check DEFINITION.md "Brain 版本" line
if [[ -f "DEFINITION.md" ]]; then
    DOC_VERSION=$(grep -oP 'Brain\s+版本[^:]*:\s*\K\S+' DEFINITION.md | head -1)
    if [[ -z "$DOC_VERSION" ]]; then
        echo "⚠️  DEFINITION.md: no 'Brain 版本' line found, skipping"
    elif [[ "$DOC_VERSION" != "$BASE_VERSION" ]]; then
        echo "❌ DEFINITION.md: $DOC_VERSION (expected: $BASE_VERSION)"
        ERRORS=$((ERRORS + 1))
    else
        echo "✅ DEFINITION.md: $DOC_VERSION"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $ERRORS -gt 0 ]]; then
    echo "  ❌ Version mismatch ($ERRORS files)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Fix:"
    echo "  cd packages/brain && npm version patch --no-git-tag-version"
    echo "  cd .. && jq -r .version packages/brain/package.json > .brain-versions"
    echo "  # Update DEFINITION.md 'Brain 版本' line"
    echo ""
    exit 1
else
    echo "  ✅ All version files in sync"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
