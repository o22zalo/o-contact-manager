'use strict';

const { getFirestore } = require('./firebase-admin');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function encodeCursor(docId) {
  return Buffer.from(docId, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try { return Buffer.from(cursor, 'base64url').toString('utf8'); } catch { return null; }
}

function parseQueryParams(query = {}) {
  const limit = Math.min(parseInt(query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const validSorts = ['updatedAt', 'createdAt', 'displayName'];
  const sort = validSorts.includes(query.sort) ? query.sort : 'updatedAt';
  const order = query.order === 'asc' ? 'asc' : 'desc';
  return {
    search: query.search?.trim().toLowerCase() || null,
    category: query.category?.trim() || null,
    domain: query.domain?.trim().toLowerCase() || null,
    email: query.email?.trim().toLowerCase() || null,
    udKey: query.udKey?.trim() || null,
    hasUD: query.hasUD === 'true' ? true : query.hasUD === 'false' ? false : null,
    sort, order, limit,
    cursor: query.cursor || null,
  };
}


function validateQueryParams(params) {
  const hasFilter = Boolean(params.search || params.category || params.domain || params.email || params.udKey || params.hasUD !== null);
  if (hasFilter && (params.sort !== 'updatedAt' || params.order !== 'desc')) {
    const err = new Error('Filtered queries currently support only sort=updatedAt&order=desc');
    err.statusCode = 400;
    throw err;
  }
}

function buildQuery(params) {
  const db = getFirestore();
  let q = db.collection('contacts_index');
  const { search, category, domain, email, udKey, hasUD, sort, order } = params;

  if (search && search.length >= 2) {
    q = q.where('searchTokens', 'array-contains', search);
  } else if (email) {
    q = q.where('allEmails', 'array-contains', email);
  } else if (udKey) {
    // Firestore không hỗ trợ 2 điều kiện array-contains trong cùng một query.
    // Khi có cả category + udKey, query theo udKey trước và lọc category ở tầng ứng dụng.
    q = q.where('userDefinedKeys', 'array-contains', udKey);
  } else if (category) {
    q = q.where('categories', 'array-contains', category);
  } else if (domain) {
    q = q.where('allDomains', 'array-contains', domain);
  }

  if (hasUD === true) q = q.where('hasUserDefined', '==', true);
  else if (hasUD === false) q = q.where('hasUserDefined', '==', false);

  q = q.orderBy(sort, order);
  return q;
}

async function paginateQuery(params) {
  const db = getFirestore();
  let q = buildQuery(params);
  const needsCategoryPostFilter = Boolean(params.category && params.udKey);
  const pageSize = needsCategoryPostFilter
    ? Math.min(Math.max(params.limit * 3, 60), 500)
    : params.limit + 1;
  const collected = [];

  let lastDoc = null;
  if (params.cursor) {
    const docId = decodeCursor(params.cursor);
    if (docId) {
      const cursorSnap = await db.collection('contacts_index').doc(docId).get();
      if (cursorSnap.exists) lastDoc = cursorSnap;
    }
  }

  while (collected.length < params.limit + 1) {
    let batchQuery = q.limit(pageSize);
    if (lastDoc) batchQuery = batchQuery.startAfter(lastDoc);

    const snapshot = await batchQuery.get();
    const docs = snapshot.docs;
    if (!docs.length) break;

    lastDoc = docs[docs.length - 1];

    const matchedDocs = needsCategoryPostFilter
      ? docs.filter((doc) => {
          const categories = doc.get('categories');
          return Array.isArray(categories) && categories.includes(params.category);
        })
      : docs;

    for (const doc of matchedDocs) {
      collected.push(doc);
      if (collected.length >= params.limit + 1) break;
    }

    if (!needsCategoryPostFilter || docs.length < pageSize) break;
  }

  const hasMore = collected.length > params.limit;
  const resultDocs = hasMore ? collected.slice(0, params.limit) : collected;
  const data = resultDocs.map(d => d.data());
  const nextCursor = hasMore ? encodeCursor(resultDocs[resultDocs.length - 1].id) : null;
  return { data, nextCursor, hasMore, count: data.length };
}

function buildListResponse(paginateResult, params) {
  const { data, nextCursor, hasMore, count } = paginateResult;
  return { data, meta: { count, limit: params.limit, hasMore, nextCursor, sort: params.sort, order: params.order } };
}

module.exports = { parseQueryParams, validateQueryParams, buildQuery, paginateQuery, buildListResponse, encodeCursor, decodeCursor, DEFAULT_LIMIT, MAX_LIMIT };
