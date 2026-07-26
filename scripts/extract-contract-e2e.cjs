#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const {
  normalizeE2EScript,
  parseCanonicalE2EScript,
} = require("./lib/test-contract-paths.cjs");

function fail(message) {
  process.stderr.write(`E2E extraction failed: ${message}\n`);
  process.exitCode = 1;
}

const contractPath = process.argv[2];
if (!contractPath) {
  fail("contract path is required");
} else {
  let content;
  try {
    content = fs.readFileSync(contractPath, "utf8");
  } catch (error) {
    fail(`cannot read contract: ${error.message}`);
  }

  if (content !== undefined) {
    const script = parseCanonicalE2EScript(content);
    if (
      script === null ||
      normalizeE2EScript(script).length === 0
    ) {
      fail("missing, ambiguous, or empty E2E bash evidence");
    } else {
      process.stdout.write(script);
    }
  }
}
