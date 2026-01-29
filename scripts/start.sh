#!/bin/bash
# Cecelia Semantic Brain - Start Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Default port
PORT=${PORT:-5220}

echo "Starting Cecelia Semantic Brain on port $PORT..."

# Check if running in Docker mode
if [ "$1" = "--docker" ]; then
    echo "Starting with Docker Compose..."
    docker-compose up -d
    echo "Service started. Check logs with: docker-compose logs -f"
else
    echo "Starting with uvicorn..."
    PYTHONPATH="$PROJECT_DIR" python -m uvicorn src.api.main:app --host 0.0.0.0 --port "$PORT"
fi
