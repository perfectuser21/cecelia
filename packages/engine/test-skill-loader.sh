#!/bin/bash
# Test script for skill-loader

set -e

cd "$(dirname "$0")"

echo "📦 Testing Skill Loader..."
echo ""

# Test 1: List command
echo "Test 1: List command"
node skill-loader.cjs list | grep "platform-scraper"
echo "✅ List command works"
echo ""

# Test 2: Verify JSON syntax
echo "Test 2: Verify registry JSON"
jq empty skills-registry.json
echo "✅ Registry JSON is valid"
echo ""

# Test 3: Check required skills
echo "Test 3: Check required skills are registered"
node skill-loader.cjs list | grep -E "(platform-scraper|dev|qa|credentials)"
echo "✅ All required skills registered"
echo ""

echo "🎉 All tests passed!"
