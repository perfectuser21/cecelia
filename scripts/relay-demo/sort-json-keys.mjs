import { readFileSync } from 'node:fs';

function sortJsonKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, sortJsonKeys(value[key])]),
    );
  }

  return value;
}

const inputPath = process.argv[2];
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const sorted = sortJsonKeys(input);

process.stdout.write(`${JSON.stringify(sorted)}\n`);
