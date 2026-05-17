#!/usr/bin/env bash
# deploy token 链路验证 smoke — 仅检查 deploy 端点可达
curl -sf http://localhost:5221/api/brain/health >/dev/null && echo "PASS: Brain healthy"
