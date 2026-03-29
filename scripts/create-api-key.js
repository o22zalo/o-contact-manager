#!/usr/bin/env node
'use strict';

/**
 * scripts/create-api-key.js — Tạo API key mới
 *
 * Usage:
 *   node scripts/create-api-key.js
 *   node scripts/create-api-key.js --name "My App"
 *   node scripts/create-api-key.js --name "CI Bot" --expires 2027-01-01
 *
 * Sẽ in ra API key một lần (không lưu key gốc) — hãy copy ngay.
 * Hash của key được lưu vào Realtime DB /api_keys/{keyHash}
 */

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getRtdb } = require('../src/utils/firebase-admin');

const WRITE_TIMEOUT_MS = Number(process.env.API_KEY_WRITE_TIMEOUT_MS || 45000);
const WRITE_RETRY_COUNT = Number(process.env.API_KEY_WRITE_RETRY_COUNT || 2);

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let name = 'Default';
let expiresAt = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) name = args[++i];
  if (args[i] === '--expires' && args[i + 1]) expiresAt = args[++i];
}

// ─── Generate ─────────────────────────────────────────────────────────────────
function generateApiKey() {
  return crypto.randomBytes(32).toString('base64url'); // 43 chars URL-safe
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function resolveDatabaseUrl() {
  if (process.env.FIREBASE_DATABASE_URL) return process.env.FIREBASE_DATABASE_URL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const region = process.env.FIREBASE_DATABASE_REGION;
  if (region) {
    return `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`;
  }
  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

function assertRequiredEnv() {
  if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error('Missing env: FIREBASE_PROJECT_ID');
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountPath) {
    const resolvedPath = path.resolve(serviceAccountPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Service account file not found: ${resolvedPath}. ` +
          'Check FIREBASE_SERVICE_ACCOUNT_PATH/GOOGLE_APPLICATION_CREDENTIALS.'
      );
    }
  }

  const databaseUrl = resolveDatabaseUrl();
  if (databaseUrl.includes('<') || databaseUrl.includes('>')) {
    throw new Error(
      `FIREBASE_DATABASE_URL không hợp lệ (${databaseUrl}). Hãy dùng URL thật từ Firebase Console.`
    );
  }
}

function validateExpiresAt() {
  if (!expiresAt) return;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid --expires value. Expected date format like 2027-01-01.');
  }
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out after ${ms}ms while writing API key to Firebase RTDB`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function writeApiKeyWithRetry(rtdb, keyHash, keyData) {
  let lastErr;
  for (let attempt = 1; attempt <= WRITE_RETRY_COUNT + 1; attempt++) {
    try {
      await withTimeout(rtdb.ref(`api_keys/${keyHash}`).set(keyData), WRITE_TIMEOUT_MS);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt > WRITE_RETRY_COUNT) break;
      console.warn(
        `⚠️  Attempt ${attempt}/${WRITE_RETRY_COUNT + 1} failed: ${err.message}. Retrying...`
      );
    }
  }
  throw lastErr;
}

async function main() {
  try {
    assertRequiredEnv();
    validateExpiresAt();

    const apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);

    const keyData = {
      name,
      active: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    if (expiresAt) keyData.expiresAt = expiresAt;

    const databaseUrl = resolveDatabaseUrl();
    const rtdb = getRtdb();
    await writeApiKeyWithRetry(rtdb, keyHash, keyData);

    console.log('\n✅ API key created successfully!\n');
    console.log('━'.repeat(60));
    console.log(`  Name:       ${name}`);
    console.log(`  Key:        ${apiKey}`);
    console.log(`  Hash:       ${keyHash.slice(0, 16)}...`);
    console.log(`  Created:    ${keyData.createdAt}`);
    console.log(`  RTDB URL:   ${databaseUrl}`);
    if (expiresAt) console.log(`  Expires:    ${expiresAt}`);
    console.log('━'.repeat(60));
    console.log('\n⚠️  Copy this key now — it will NOT be shown again.\n');
    console.log('Usage: Authorization: Bearer ' + apiKey);
    console.log('');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Failed to create API key:', err.message);
    if (process.env.FIREBASE_PROJECT_ID) {
      console.error(`Resolved RTDB URL: ${resolveDatabaseUrl()}`);
    }
    console.error(
      'Tips: kiểm tra FIREBASE_DATABASE_URL chính xác từ Firebase Console (Realtime Database > Data), service account và network/firewall.'
    );
    process.exit(1);
  }
}

main();
