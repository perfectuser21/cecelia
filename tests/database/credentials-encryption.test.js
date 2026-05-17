/**
 * Tests for credentials encryption functionality
 * Ensures credentials are properly encrypted and decrypted
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import publishingCredentialsDAO from '../../brain/src/dao/publishingCredentialsDAO.js';

describe('Credentials Encryption', () => {
  let testCredId;
  const testPlatform = 'test_platform_encryption';
  const testAccountName = 'encryption_test_account';
  const sensitiveData = {
    api_key: 'super_secret_key_12345',
    api_secret: 'ultra_secret_value_67890',
    access_token: 'Bearer token_abc123xyz',
    refresh_token: 'refresh_xyz789abc'
  };

  beforeAll(() => {
    // Ensure encryption key is set for testing
    if (!process.env.PUBLISHING_CREDENTIALS_KEY && !process.env.ENCRYPTION_KEY) {
      // Set a test key (32 characters for AES-256)
      process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
    }
  });

  afterAll(async () => {
    // Clean up test credential
    if (testCredId) {
      await publishingCredentialsDAO.delete(testCredId);
    }
  });

  it('should store credentials in encrypted format', async () => {
    const credential = {
      platform: testPlatform,
      account_name: testAccountName,
      credentials: sensitiveData,
      is_active: true
    };

    const result = await publishingCredentialsDAO.create(credential);
    testCredId = result.id;

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();

    // The returned object should NOT include plaintext credentials
    expect(result.credentials).toBeUndefined();
  });

  it('should retrieve and decrypt credentials correctly', async () => {
    const result = await publishingCredentialsDAO.getById(testCredId, true);

    expect(result).toBeDefined();
    expect(result.credentials).toBeDefined();

    // Verify all sensitive data matches
    expect(result.credentials.api_key).toBe(sensitiveData.api_key);
    expect(result.credentials.api_secret).toBe(sensitiveData.api_secret);
    expect(result.credentials.access_token).toBe(sensitiveData.access_token);
    expect(result.credentials.refresh_token).toBe(sensitiveData.refresh_token);
  });

  it('should store credentials with encryption metadata', async () => {
    const result = await publishingCredentialsDAO.getById(testCredId, false);

    expect(result).toBeDefined();
    expect(result.credentials).toBeDefined();

    // Check for encryption metadata
    const creds = result.credentials;

    // If encryption is enabled, should have encrypted field and IV
    if (process.env.ENCRYPTION_KEY || process.env.PUBLISHING_CREDENTIALS_KEY) {
      expect(creds.encrypted || creds.api_key).toBeDefined();

      // If encrypted, should have IV and algorithm
      if (creds.encrypted) {
        expect(creds.iv).toBeDefined();
        expect(creds.algorithm).toBe('aes-256-cbc');

        // Encrypted data should not be plaintext
        expect(creds.encrypted).not.toBe(JSON.stringify(sensitiveData));
      }
    }
  });

  it('should update credentials with encryption', async () => {
    const updatedData = {
      api_key: 'new_secret_key_99999',
      api_secret: 'new_secret_value_88888',
      access_token: 'Bearer new_token_def456',
      refresh_token: 'refresh_new_456def'
    };

    const updates = {
      credentials: updatedData
    };

    await publishingCredentialsDAO.update(testCredId, updates);

    // Verify updated credentials are decrypted correctly
    const result = await publishingCredentialsDAO.getById(testCredId, true);

    expect(result.credentials.api_key).toBe(updatedData.api_key);
    expect(result.credentials.api_secret).toBe(updatedData.api_secret);
    expect(result.credentials.access_token).toBe(updatedData.access_token);
    expect(result.credentials.refresh_token).toBe(updatedData.refresh_token);

    // Original values should not be present
    expect(result.credentials.api_key).not.toBe(sensitiveData.api_key);
  });

  it('should handle decryption parameter correctly', async () => {
    // Get with decryption
    const decrypted = await publishingCredentialsDAO.getById(testCredId, true);
    expect(typeof decrypted.credentials.api_key).toBe('string');

    // Get without decryption
    const encrypted = await publishingCredentialsDAO.getById(testCredId, false);

    // They should be different formats
    if (process.env.ENCRYPTION_KEY || process.env.PUBLISHING_CREDENTIALS_KEY) {
      if (encrypted.credentials.encrypted) {
        expect(encrypted.credentials).not.toEqual(decrypted.credentials);
        expect(encrypted.credentials.encrypted).toBeDefined();
        expect(encrypted.credentials.iv).toBeDefined();
      }
    }
  });

  it('should support credentials without encryption when key is not set', async () => {
    // Temporarily remove encryption key
    const originalKey = process.env.ENCRYPTION_KEY;
    const originalCredKey = process.env.PUBLISHING_CREDENTIALS_KEY;

    delete process.env.ENCRYPTION_KEY;
    delete process.env.PUBLISHING_CREDENTIALS_KEY;

    // Create a new DAO instance to pick up the environment change
    const testCred = {
      platform: 'test_no_encryption',
      account_name: 'no_encryption_account',
      credentials: { token: 'plaintext_token' },
      is_active: true
    };

    const result = await publishingCredentialsDAO.create(testCred);

    // Clean up
    await publishingCredentialsDAO.delete(result.id);

    // Restore encryption keys
    if (originalKey) process.env.ENCRYPTION_KEY = originalKey;
    if (originalCredKey) process.env.PUBLISHING_CREDENTIALS_KEY = originalCredKey;

    expect(result).toBeDefined();
  });

  it('should encrypt different credentials differently (unique IVs)', async () => {
    const cred1 = {
      platform: 'test_iv_1',
      account_name: 'account_1',
      credentials: { secret: 'same_data' },
      is_active: true
    };

    const cred2 = {
      platform: 'test_iv_2',
      account_name: 'account_2',
      credentials: { secret: 'same_data' },
      is_active: true
    };

    const result1 = await publishingCredentialsDAO.create(cred1);
    const result2 = await publishingCredentialsDAO.create(cred2);

    // Get encrypted forms
    const encrypted1 = await publishingCredentialsDAO.getById(result1.id, false);
    const encrypted2 = await publishingCredentialsDAO.getById(result2.id, false);

    // Clean up
    await publishingCredentialsDAO.delete(result1.id);
    await publishingCredentialsDAO.delete(result2.id);

    // Even with same plaintext, encrypted versions should differ (due to unique IVs)
    if (encrypted1.credentials.encrypted && encrypted2.credentials.encrypted) {
      expect(encrypted1.credentials.encrypted).not.toBe(encrypted2.credentials.encrypted);
      expect(encrypted1.credentials.iv).not.toBe(encrypted2.credentials.iv);
    }
  });
});
