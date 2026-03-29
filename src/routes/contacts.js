'use strict';

/**
 * routes/contacts.js — CRUD endpoints cho contacts
 *
 * GET    /contacts             — list + search + filter (cursor pagination)
 * GET    /contacts/:id         — detail (2 reads: index + detail)
 * POST   /contacts             — tạo mới
 * PUT    /contacts/:id         — cập nhật toàn bộ
 * PATCH  /contacts/:id         — cập nhật từng phần (merge)
 * DELETE /contacts/:id         — xóa
 */

const express = require('express');
const router = express.Router();

const { getFirestore } = require('../utils/firebase-admin');
const { writeContact, deleteContact } = require('../utils/writeContact');
const { parseQueryParams, validateQueryParams, paginateQuery, buildListResponse } = require('../utils/pagination');

function internalError(res, req, err, context) {
  console.error(context, req.requestId, err);
  return res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Unexpected error',
    requestId: req.requestId,
  });
}

// ─── GET /contacts ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const params = parseQueryParams(req.query);

    // search cần tối thiểu 2 ký tự
    if (params.search && params.search.length < 2) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'search param must be at least 2 characters',
      });
    }

    validateQueryParams(params);

    const result = await paginateQuery(params);
    return res.json(buildListResponse(result, params));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: 'Bad Request', message: err.message });
    }
    return internalError(res, req, err, '[GET /contacts]');
  }
});

// ─── GET /contacts/:id ────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = getFirestore();
    const [indexSnap, detailSnap] = await Promise.all([
      db.collection('contacts_index').doc(id).get(),
      db.collection('contacts_detail').doc(id).get(),
    ]);

    if (!indexSnap.exists) {
      return res.status(404).json({ error: 'Not Found', message: `Contact ${id} not found` });
    }

    return res.json({
      data: {
        ...indexSnap.data(),
        detail: detailSnap.exists ? detailSnap.data() : null,
      },
    });
  } catch (err) {
    return internalError(res, req, err, `[GET /contacts/${id}]`);
  }
});

// ─── POST /contacts ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Bad Request', message: 'Request body is required' });
  }

  // Validate tối thiểu: phải có displayName hoặc email
  const contact = body.contact || body;
  const hasName = !!(contact.displayName || contact.fn || contact.name);
  const hasEmail = Array.isArray(contact.emails)
    ? contact.emails.length > 0
    : !!contact.email;

  if (!hasName && !hasEmail) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Contact must have at least displayName or an email address',
    });
  }

  try {
    const result = await writeContact(body, { isUpdate: false });
    return res.status(201).json({
      data: { contactId: result.contactId },
      meta: { emailCount: result.emailCount, udKeyCount: result.udKeyCount },
    });
  } catch (err) {
    return internalError(res, req, err, '[POST /contacts]');
  }
});

// ─── PUT /contacts/:id ────────────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Bad Request', message: 'Request body is required' });
  }

  try {
    const db = getFirestore();
    const exists = await db.collection('contacts_index').doc(id).get();
    if (!exists.exists) {
      return res.status(404).json({ error: 'Not Found', message: `Contact ${id} not found` });
    }

    const result = await writeContact(body, { contactId: id, isUpdate: true });
    return res.json({
      data: { contactId: result.contactId },
      meta: { emailCount: result.emailCount, udKeyCount: result.udKeyCount },
    });
  } catch (err) {
    return internalError(res, req, err, `[PUT /contacts/${id}]`);
  }
});

// ─── PATCH /contacts/:id ──────────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const patch = req.body;
  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'Bad Request', message: 'Request body is required' });
  }

  try {
    const db = getFirestore();
    const [indexSnap, detailSnap] = await Promise.all([
      db.collection('contacts_index').doc(id).get(),
      db.collection('contacts_detail').doc(id).get(),
    ]);

    if (!indexSnap.exists) {
      return res.status(404).json({ error: 'Not Found', message: `Contact ${id} not found` });
    }

    // Merge patch vào detail hiện tại, rồi ghi lại toàn bộ
    const existing = detailSnap.exists ? detailSnap.data() : {};
    const patchContact = patch.contact || patch;
    const patchUD = patch.userDefined || null;

    const merged = {
      contact: {
        ...(existing.contact || {}),
        ...patchContact,
      },
      userDefined: patchUD
        ? { ...(existing.userDefined || {}), ...patchUD }
        : (existing.userDefined || {}),
      vcfRaw: patch.vcfRaw || existing.vcfRaw || null,
    };

    const result = await writeContact(merged, { contactId: id, isUpdate: true });
    return res.json({
      data: { contactId: result.contactId },
      meta: { emailCount: result.emailCount, udKeyCount: result.udKeyCount },
    });
  } catch (err) {
    return internalError(res, req, err, `[PATCH /contacts/${id}]`);
  }
});

// ─── DELETE /contacts/:id ─────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await deleteContact(id);
    return res.json({
      data: { contactId: result.contactId },
      meta: {
        deletedEmails: result.deletedEmails,
        cleanedUdKeys: result.cleanedUdKeys,
      },
    });
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    return internalError(res, req, err, `[DELETE /contacts/${id}]`);
  }
});

module.exports = router;
