'use strict';

/**
 * routes/meta.js — Stats & metadata endpoints
 *
 * GET /contacts/meta/stats — thống kê tổng (1 read)
 */

const express = require('express');
const router = express.Router();

const { getFirestore } = require('../utils/firebase-admin');

function internalError(res, req, err, context) {
  console.error(context, req.requestId, err);
  return res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Unexpected error',
    requestId: req.requestId,
  });
}

router.get('/stats', async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection('meta').doc('stats').get();

    if (!snap.exists) {
      // Trả về zero stats nếu chưa có
      return res.json({
        data: {
          totalContacts: 0,
          totalEmails: 0,
          totalWithUserDefined: 0,
          lastImportAt: null,
          lastImportCount: 0,
        },
      });
    }

    return res.json({ data: snap.data() });
  } catch (err) {
    return internalError(res, req, err, '[GET /meta/stats]');
  }
});

module.exports = router;
