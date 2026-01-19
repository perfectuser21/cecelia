#!/bin/bash
# Deploy script for zenithjoy-autopilot frontend
# Usage: ./deploy.sh [branch]
# Default: current branch

set -e

BRANCH=${1:-$(git rev-parse --abbrev-ref HEAD)}
REPO_DIR="/home/xx/dev/zenithjoy-autopilot"
FRONTEND_DIR="$REPO_DIR/apps/dashboard/frontend"

cd "$REPO_DIR"

echo "📦 Deploying zenithjoy-autopilot frontend ($BRANCH)..."

# Pull latest changes
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# Build frontend
cd "$FRONTEND_DIR"
echo "📥 Installing dependencies..."
npm ci

echo "🔨 Building frontend..."
npm run build

# Copy to appropriate dist directory and restart container
if [ "$BRANCH" = "main" ]; then
  echo "🚀 Deploying to production (dist → port 5211)..."
  # dist is already the build output directory
  docker restart zenithjoy-core
  echo "✅ Production deployment complete"
elif [ "$BRANCH" = "develop" ]; then
  echo "🚀 Deploying to dev (dist-dev → port 5212)..."
  rm -rf "$FRONTEND_DIR/dist-dev"
  cp -r "$FRONTEND_DIR/dist" "$FRONTEND_DIR/dist-dev"
  docker restart zenithjoy-core-dev
  echo "✅ Dev deployment complete"
else
  echo "⚠️  Unknown branch: $BRANCH (not deploying)"
fi
