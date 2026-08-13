#!/bin/bash
set -e
cd /workspace
node packages/brain/node_modules/.bin/vitest run \
  --config packages/brain/vitest.integration.config.js \
  packages/brain/src/__tests__/integration/kernel-controller-ownership.pg.integration.test.js \
  --reporter verbose
