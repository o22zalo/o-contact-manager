'use strict';

/**
 * routes/lookup.js — Reverse lookup endpoints
 *
 * GET /contacts/by-email/:email   — lookup email → contact (O1, 3 reads)
 * GET /contacts/by-ud-key/:key    — lookup udKey → tất cả contacts (1+N reads)
 * GET /contacts/ud-keys           — liệt kê tất cả userDefined keys (~10-30 reads)
 *
 * NOTE: Các route này phải được mount TRƯỚC /contacts/:id trong index.js
 * để tránh conflict "by-email" bị match làm contactId.
 */

const express = require('express');
const router = express.Router();

const { getFirestore } = require('../utils/firebase-admin');
const { encodeDocId } = require('../utils/contactMapper');

function internalError(res, req, err, context) {
  console.error(context, req.requestId, err);
  return res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Unexpected error',
    requestId: req.requestId,
  });
}

// ─── GET /contacts/by-email/:email ───────────────────────────────────────────

router.get('/by-email/:email', async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase().trim();

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid email address' });
  }

  try {
    const db = getFirestore();
    const docId = encodeDocId(email);

    // Read 1: email_lookup
    const lookupSnap = await db.collection('email_lookup').doc(docId).get();
    if (!lookupSnap.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: `No contact found with email: ${email}`,
      });
    }

    const { contactId, isPrimary, type, label } = lookupSnap.data();

    // Read 2+3: index + detail
    const [indexSnap, detailSnap] = await Promise.all([
      db.collection('contacts_index').doc(contactId).get(),
      db.collection('contacts_detail').doc(contactId).get(),
    ]);

    if (!indexSnap.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Contact ${contactId} no longer exists`,
      });
    }

    return res.json({
      data: {
        contactId,
        email,
        isPrimary,
        type,
        label: label || null,
        contact: indexSnap.data(),
        detail: detailSnap.exists ? detailSnap.data() : null,
      },
    });
  } catch (err) {
    return internalError(res, req, err, `[GET /contacts/by-email/${email}]`);
  }
});

// ─── GET /contacts/by-ud-key/:key ────────────────────────────────────────────

router.get('/by-ud-key/:key', async (req, res) => {
  const key = decodeURIComponent(req.params.key).trim();

  if (!key) {
    return res.status(400).json({ error: 'Bad Request', message: 'key param is required' });
  }

  try {
    const db = getFirestore();
    const docId = encodeDocId(key);

    // Read 1: ud_key_lookup
    const lookupSnap = await db.collection('ud_key_lookup').doc(docId).get();
    if (!lookupSnap.exists) {
      return res.status(404).json({
        error: 'Not Found',
        message: `No contacts found with userDefined key: ${key}`,
      });
    }

    const { contactIds = [], count } = lookupSnap.data();
    if (contactIds.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `No contacts found with userDefined key: ${key}`,
      });
    }

    // Read N: lấy contacts_index của tất cả contactIds
    const indexSnaps = await Promise.all(
      contactIds.map(id => db.collection('contacts_index').doc(id).get())
    );

    const contacts = indexSnaps
      .filter(s => s.exists)
      .map(s => s.data());

    return res.json({
      data: contacts,
      meta: {
        key,
        count: contacts.length,
        totalInLookup: count,
      },
    });
  } catch (err) {
    return internalError(res, req, err, `[GET /contacts/by-ud-key/${req.params.key}]`);
  }
});

// ─── GET /contacts/ud-keys ────────────────────────────────────────────────────

router.get('/ud-keys', async (req, res) => {
  try {
    const db = getFirestore();

    // Query toàn bộ ud_key_lookup collection (~10-30 docs)
    const snapshot = await db.collection('ud_key_lookup').orderBy('key').get();

    const keys = snapshot.docs.map(d => {
      const data = d.data();
      return {
        key: data.key,
        count: (data.contactIds || []).length,
        updatedAt: data.updatedAt || null,
      };
    });

    return res.json({
      data: keys,
      meta: { total: keys.length },
    });
  } catch (err) {
    return internalError(res, req, err, '[GET /contacts/ud-keys]');
  }
});

module.exports = router;
