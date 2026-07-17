#!/bin/bash
# cockpit-route-wire smoke: 验证 App.tsx 挂载 OwnerCockpitPage
set -e
grep -q "OwnerCockpitPage" apps/dashboard/src/App.tsx && echo "PASS: smoke cockpit-route-wire" || (echo "FAIL" && exit 1)
