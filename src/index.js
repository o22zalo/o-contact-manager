'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { nanoid } = require('nanoid');

const { authMiddleware } = require('./middleware/auth');
const contactsRouter = require('./routes/contacts');
const lookupRouter = require('./routes/lookup');
const bulkRouter = require('./routes/bulk');
const metaRouter = require('./routes/meta');

const app = express();
const requestBuckets = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

function buildCorsOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const rawOrigins = process.env.CORS_ORIGINS || '';
  const allowedOrigins = rawOrigins
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!isProd) {
    return { origin: true };
  }

  if (allowedOrigins.length === 0) {
    return { origin: false };
  }

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin denied'));
    },
  };
}

function rateLimitMiddleware(req, res, next) {
  if (req.path === '/health') return next();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = requestBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    requestBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded (${RATE_LIMIT_MAX} requests/minute)`,
    });
  }

  bucket.count += 1;
  return next();
}

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: '10mb' })); // bulk import cần limit cao hơn
app.use(express.urlencoded({ extended: false }));
app.use(rateLimitMiddleware);
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || `req_${nanoid(10)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return next();
});

// ─── Health check (không cần auth) ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Auth middleware (áp dụng cho tất cả /contacts routes) ───────────────────
app.use('/contacts', authMiddleware);

// ─── Routes — thứ tự quan trọng! ─────────────────────────────────────────────
// lookup & bulk & meta phải mount TRƯỚC contacts/:id để tránh conflict

// /contacts/by-email/:email, /contacts/by-ud-key/:key, /contacts/ud-keys
app.use('/contacts', lookupRouter);

// /contacts/bulk/import, /contacts/bulk/export
app.use('/contacts/bulk', bulkRouter);

// /contacts/meta/stats
app.use('/contacts/meta', metaRouter);

// /contacts (CRUD — :id route là cuối)
app.use('/contacts', contactsRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', req.requestId, err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    requestId: req.requestId,
  });
});

// ─── Start server (standalone mode) ──────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`✅ Contact Manager API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
  });

  process.on('SIGTERM', () => {
    console.log('⚠️  SIGTERM received, closing HTTP server...');
    server.close(() => {
      console.log('✅ HTTP server closed.');
      process.exit(0);
    });
  });
}

// Export for Cloud Functions hoặc testing
module.exports = app;
