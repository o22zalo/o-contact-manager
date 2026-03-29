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
const { getRtdb } = require('../src/utils/firebase-admin');

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

async function main() {
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);

  const keyData = {
    name,
    active: true,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  if (expiresAt) keyData.expiresAt = expiresAt;

  try {
    const rtdb = getRtdb();
    await rtdb.ref(`api_keys/${keyHash}`).set(keyData);

    console.log('\n✅ API key created successfully!\n');
    console.log('━'.repeat(60));
    console.log(`  Name:       ${name}`);
    console.log(`  Key:        ${apiKey}`);
    console.log(`  Hash:       ${keyHash.slice(0, 16)}...`);
    console.log(`  Created:    ${keyData.createdAt}`);
    if (expiresAt) console.log(`  Expires:    ${expiresAt}`);
    console.log('━'.repeat(60));
    console.log('\n⚠️  Copy this key now — it will NOT be shown again.\n');
    console.log('Usage: Authorization: Bearer ' + apiKey);
    console.log('');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Failed to create API key:', err.message);
    process.exit(1);
  }
}

main();
