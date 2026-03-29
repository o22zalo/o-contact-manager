'use strict';

/**
 * routes/bulk.js — Bulk import & export endpoints
 *
 * POST /contacts/bulk/import  — async bulk import (job tracked in Realtime DB)
 * GET  /contacts/bulk/export  — export toàn bộ contacts (JSON hoặc VCF)
 */

const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');

const { getFirestore, getRtdb } = require('../utils/firebase-admin');
const { bulkWriteContacts } = require('../utils/writeContact');

// ─── POST /contacts/bulk/import ───────────────────────────────────────────────

/**
 * Body: { contacts: [...], sourceFile?: string }
 * contacts: mảng contact JSON objects (format giống POST /contacts)
 *
 * Response ngay lập tức với jobId, sau đó xử lý async.
 * Progress theo dõi tại Realtime DB: /import_jobs/{jobId}
 */
router.post('/import', async (req, res) => {
  const { contacts, sourceFile } = req.body || {};

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Body must contain a non-empty "contacts" array',
    });
  }

  const MAX_BATCH = 5000;
  if (contacts.length > MAX_BATCH) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `Maximum ${MAX_BATCH} contacts per import request`,
    });
  }

  const jobId = `job_${nanoid(12)}`;
  const rtdb = getRtdb();

  // Khởi tạo job record trong Realtime DB
  await rtdb.ref(`import_jobs/${jobId}`).set({
    status: 'running',
    total: contacts.length,
    done: 0,
    success: 0,
    errors: [],
    sourceFile: sourceFile || null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  // Trả về ngay — xử lý async
  res.status(202).json({
    data: { jobId },
    meta: {
      total: contacts.length,
      statusUrl: `/contacts/bulk/import/${jobId}`,
      message: 'Import started. Check jobId for progress.',
    },
  });

  // Async processing (fire and forget)
  ;(async () => {
    try {
      const result = await bulkWriteContacts(
        contacts.map(c => ({ ...c, sourceFile: sourceFile || null })),
        {
          concurrency: 5,
          onProgress: async (d) => {
            // Cập nhật progress mỗi 50 contacts để tránh quá nhiều writes
            if (d % 50 === 0 || d === contacts.length) {
              await rtdb.ref(`import_jobs/${jobId}`).update({ done: d }).catch(() => {});
            }
          },
        }
      );

      // Cập nhật stats Firestore sau import
      await updateStats(contacts.length, result.errors.length).catch(() => {});

      await rtdb.ref(`import_jobs/${jobId}`).update({
        status: 'completed',
        done: contacts.length,
        success: result.success,
        errors: result.errors.slice(0, 100), // limit để tránh quá lớn
        finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[bulk/import] Job ${jobId} failed:`, err);
      await rtdb.ref(`import_jobs/${jobId}`).update({
        status: 'failed',
        error: err.message,
        finishedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  })();
});

/**
 * GET /contacts/bulk/import/:jobId — status của 1 import job
 */
router.get('/import/:jobId', async (req, res) => {
  const { jobId } = req.params;
  try {
    const rtdb = getRtdb();
    const snap = await rtdb.ref(`import_jobs/${jobId}`).once('value');
    if (!snap.exists()) {
      return res.status(404).json({ error: 'Not Found', message: `Job ${jobId} not found` });
    }
    return res.json({ data: snap.val() });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ─── GET /contacts/bulk/export ────────────────────────────────────────────────

/**
 * Query params:
 *   format  — json (default) | vcf
 *   limit   — max contacts, default 10000
 *   category — filter theo category (optional)
 */
router.get('/export', async (req, res) => {
  const format = req.query.format === 'vcf' ? 'vcf' : 'json';
  const limit = Math.min(parseInt(req.query.limit, 10) || 10000, 30000);
  const category = req.query.category?.trim() || null;

  try {
    const db = getFirestore();
    let q = db.collection('contacts_detail');

    // Nếu filter theo category, query contacts_index trước để lấy IDs
    if (category) {
      const indexSnap = await db
        .collection('contacts_index')
        .where('categories', 'array-contains', category)
        .limit(limit)
        .get();

      const contactIds = indexSnap.docs.map(d => d.id);

      if (contactIds.length === 0) {
        return sendExport(res, [], format, 0);
      }

      // Batch read detail docs (Firestore in() limit = 30)
      const chunks = chunkArray(contactIds, 30);
      const allDetails = [];
      for (const chunk of chunks) {
        const snap = await db
          .collection('contacts_detail')
          .where('id', 'in', chunk)
          .get();
        allDetails.push(...snap.docs.map(d => d.data()));
      }
      return sendExport(res, allDetails, format, allDetails.length);
    }

    // Export tất cả (không filter)
    const snapshot = await q.limit(limit).get();
    const details = snapshot.docs.map(d => d.data());
    return sendExport(res, details, format, details.length);
  } catch (err) {
    console.error('[GET /bulk/export]', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendExport(res, contacts, format, count) {
  if (format === 'vcf') {
    const vcf = contacts
      .map(c => c.vcfRaw || contactToVcf(c))
      .filter(Boolean)
      .join('\n');
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
    return res.send(vcf);
  }

  // JSON format
  res.setHeader('Content-Disposition', 'attachment; filename="contacts.json"');
  return res.json({
    data: contacts,
    meta: { count, exportedAt: new Date().toISOString() },
  });
}

/**
 * Tạo VCF đơn giản từ detail doc (nếu không có vcfRaw)
 * @param {object} detail
 * @returns {string}
 */
function contactToVcf(detail) {
  if (!detail || !detail.contact) return null;
  const c = detail.contact;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  if (c.displayName) lines.push(`FN:${c.displayName}`);
  if (c.name) {
    const n = c.name;
    lines.push(`N:${n.family || ''};${n.given || ''};${n.middle || ''};;`);
  }
  if (c.organization) lines.push(`ORG:${c.organization}`);
  for (const e of (c.emails || [])) {
    const types = (e.type || ['INTERNET']).join(',');
    lines.push(`EMAIL;TYPE=${types}:${e.value}`);
  }
  for (const p of (c.phones || [])) {
    const types = (p.type || ['VOICE']).join(',');
    lines.push(`TEL;TYPE=${types}:${p.value}`);
  }
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/**
 * Cập nhật meta/stats sau import
 * @param {number} added
 * @param {number} errored
 */
async function updateStats(added, errored) {
  const db = getFirestore();
  const { FieldValue } = require('../utils/firebase-admin');
  await db.collection('meta').doc('stats').set(
    {
      totalContacts: FieldValue.increment(added - errored),
      lastImportAt: new Date().toISOString(),
      lastImportCount: added - errored,
    },
    { merge: true }
  );
}

module.exports = router;
