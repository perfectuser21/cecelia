#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

/**
 * Extract every executable bash block from the one recognized E2E section.
 * The heading grammar is the Harness skill's intended H2+ line-start family.
 * Multiple sections fail closed; multiple bash blocks within the one section
 * are concatenated in document order for v1.22 compatibility.
 *
 * @param {string} content
 * @returns {string | null}
 */
function parseCanonicalE2EScript(content) {
  if (typeof content !== "string") return null;
  const normalized = content.replace(/\r\n?/g, "\n");
  const headers = [
    ...normalized.matchAll(/^##+[ \t]*E2E[ \t]*验收[^\n]*\n/gm),
  ];
  if (headers.length !== 1) return null;

  const header = headers[0];
  const sectionStart = header.index + header[0].length;
  const afterHeader = normalized.slice(sectionStart);
  const nextSection = afterHeader.search(/^##[ \t]+[^\n]/m);
  const section =
    nextSection >= 0 ? afterHeader.slice(0, nextSection) : afterHeader;
  const bashBlocks = [
    ...section.matchAll(/^```bash[ \t]*\n([\s\S]*?)^```[ \t]*$/gm),
  ];
  return bashBlocks.length >= 1
    ? bashBlocks.map((block) => block[1]).join("")
    : null;
}

/**
 * Normalize only representation-level whitespace. Leading whitespace,
 * commands, arguments, content, and ordering remain significant.
 *
 * @param {string} script
 * @returns {string}
 */
function normalizeE2EScript(script) {
  return script
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

function fail(message) {
  process.stderr.write(`E2E extraction failed: ${message}\n`);
  process.exitCode = 1;
}

function runCli() {
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
}

module.exports = {
  parseCanonicalE2EScript,
  normalizeE2EScript,
};

if (require.main === module) {
  runCli();
}
