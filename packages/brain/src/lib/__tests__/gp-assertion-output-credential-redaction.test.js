import { describe, expect, it } from 'vitest';
import { redactAndBoundOutput } from '../gp-assertion-output.js';

describe('GP assertion output credential redaction', () => {
  it('redacts AWS and URI credentials without changing ordinary URLs', () => {
    const secrets = [
      'aws-secret-value',
      'aws-session-value',
      'database-password',
      'service-password',
    ];
    const ordinaryUrl = 'https://example.com/public?q=visible';
    const output = redactAndBoundOutput([
      `AWS_SECRET_ACCESS_KEY=${secrets[0]}`,
      `AWS_SESSION_TOKEN=${secrets[1]}`,
      `DATABASE_URL=postgres://db-user:${secrets[2]}@db.internal/app`,
      `endpoint=https://api-user:${secrets[3]}@api.example.test/v1`,
      `docs=${ordinaryUrl}`,
    ].join('\n'));

    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(output).toContain('postgres://db-user:[REDACTED]@db.internal/app');
    expect(output).toContain('https://api-user:[REDACTED]@api.example.test/v1');
    expect(output).toContain(ordinaryUrl);
  });
});
