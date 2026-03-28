# Database Architecture — Self-hosted Contact Manager

> Firebase Firestore + Realtime Database | 30K contacts | REST API  
> Version 2 — thêm email_lookup, ud_key_lookup, userDefined search

---

## 1. Vấn đề cần giải quyết

| Triệu chứng                  | Nguyên nhân gốc                 | Giải pháp                                  |
| ---------------------------- | ------------------------------- | ------------------------------------------ |
| Load danh sách chậm          | Đọc 30K document đầy đủ mỗi lần | Tách `index` (nhẹ) vs `detail` (đầy đủ)    |
| Hết quota Firestore          | 1 request = 30K reads           | Pagination 50/page = 50 reads              |
| Search chậm                  | Không có index text             | Pre-compute `searchTokens` array           |
| Email phụ không tìm được     | Chỉ index `primaryEmail`        | Thêm `allEmails[]` + `email_lookup`        |
| userDefined không query được | Chỉ lưu trong `contacts_detail` | Thêm `userDefinedKeys[]` + `ud_key_lookup` |
| API phụ thuộc UI             | Không có REST layer             | Cloud Function / Express + Admin SDK       |

---

## 2. Tổng quan kiến trúc — 6 Collections

```
Firestore
├── contacts_index/{contactId}     ← list, search, filter  (~1KB/doc)
├── contacts_detail/{contactId}    ← full data on-demand   (~5–50KB/doc)
├── email_lookup/{emailId}         ← reverse lookup by email  O(1)
├── ud_key_lookup/{keyId}          ← reverse lookup by userDefined key  O(1)
├── categories/{categoryId}        ← tag management (~50 docs)
└── meta/stats                     ← global stats (1 doc)

Realtime Database
├── /api_keys/{keyHash}            ← API key management
├── /sync_status                   ← trạng thái sync
└── /import_jobs/{jobId}           ← progress bulk import
```

**Nguyên tắc thiết kế:**

- `contacts_index` + `email_lookup` + `ud_key_lookup` write cùng 1 batch — atomically
- Không bao giờ query `contacts_detail` để làm danh sách
- documentId của lookup collections dùng key encoding để tra O(1) không cần query

---

## 3. Schema chi tiết — Firestore

### 3.1 `contacts_index/{contactId}`

> Hiển thị danh sách, search, filter — đọc nhiều nhất. Mục tiêu ≤ 1KB/doc.

```jsonc
{
  // ── Identity ───────────────────────────────────────────
  "id": "uid_abc123",
  "displayName": "John Doe",
  "nameNormalized": "john doe",

  // ── Email ──────────────────────────────────────────────
  "primaryEmail": "hau@work.com",
  "emailDomain": "work.com",

  "allEmails": [
    // [MỚI] TẤT CẢ email của contact
    "hau@work.com",
    "ongtrieuhau@gmail.com",
    "hau.personal@yahoo.com",
  ],
  "allDomains": ["work.com", "gmail.com", "yahoo.com"], // [MỚI] TẤT CẢ domain

  // ── Phone / Org ────────────────────────────────────────
  "primaryPhone": "0901234567",
  "organization": "ACME Corp",
  "photoUrl": "https://...",

  // ── Categorization ─────────────────────────────────────
  "categories": ["myContacts", "friends"],
  "tags": [],

  // ── Search tokens ──────────────────────────────────────
  "searchTokens": ["j", "jo", "joh", "john", "d", "do", "doe", "john doe", "acme", "h", "ha", "hau"],

  // ── userDefined index [MỚI] ────────────────────────────
  "userDefinedKeys": ["go.2Fa.Secret", "go.2Fa.passapp", "github.token", "gitea.token", "tailscale.com.TrustCredentials"],
  "hasUserDefined": true,
  "udKeyCount": 5,

  // ── Counters ───────────────────────────────────────────
  "emailCount": 3,
  "phoneCount": 2,

  // ── Timestamps ─────────────────────────────────────────
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-03-28T10:00:00Z",
  "importedAt": "2026-03-01T00:00:00Z",
  "sourceFile": "contacts_export_2026.vcf",
  "version": 1,
}
```

---

### 3.2 `contacts_detail/{contactId}`

> Đọc khi user click vào 1 contact. documentId = `contacts_index/{contactId}`.

```jsonc
{
  "id": "uid_abc123",

  "contact": {
    "displayName": "John Doe",
    "name": { "family": "Doe", "given": "John", "additional": "Michael", "prefix": "Mr.", "suffix": "Jr." },
    "emails": [
      { "type": ["INTERNET", "WORK"], "value": "hau@work.com", "label": "Công ty" },
      { "type": ["INTERNET", "HOME"], "value": "ongtrieuhau@gmail.com", "label": "Cá nhân" },
      { "type": ["INTERNET"], "value": "hau.personal@yahoo.com" },
    ],
    "phones": [{ "type": ["CELL"], "value": "0901234567" }],
    "addresses": [
      {
        "type": ["HOME"],
        "value": {
          "street": "123 Main St",
          "city": "Ho Chi Minh",
          "country": "Vietnam",
          "postalCode": "70000",
          "poBox": "",
          "extended": "",
          "state": "",
        },
      },
    ],
    "urls": [{ "type": [], "value": "https://example.com" }],
    "birthday": "19900115",
    "anniversary": "--0423",
    "organization": "ACME Corp",
    "title": "Senior Developer",
    "categories": ["myContacts", "friends"],
    "photo": "https://...",
    "uid": "abc-123-def-456",
    "rev": "2024-01-01T00:00:00Z",
    "dates": [{ "label": "Anniversary", "value": "--0423" }],
    "extensions": { "X-CUSTOM-FIELD": "some-value" },
  },

  "userDefined": {
    "go.2Fa.Secret": "svvyitqtytdqkzcv5mbtimvxkl7qu7dk",
    "go.2Fa.AuthLink": "otpauth://totp/Google:foo@gmail.com?secret=...",
    "go.2Fa.BackupCode": "1234 5678 9012",
    "go.2Fa.passapp": ["envd wypp ybqo oczz", "mpiq ihci kbpy khtw"],
    "github.token": "ghp_xxx",
    "gitea.token": "gta_yyy",
    "tailscale.com.TrustCredentials": ["clientId: xxx -- secretId: yyy", "clientId: aaa -- secretId: bbb"],
  },

  "vcfRaw": "BEGIN:VCARD\nVERSION:3.0\n...\nEND:VCARD",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-03-28T10:00:00Z",
  "version": 1,
}
```

---

### 3.3 `email_lookup/{emailId}` — [MỚI]

> Reverse lookup: biết email → contactId ngay, không cần query.  
> **documentId = email với `.` thay bằng `,`**

```
"ongtrieuhau@gmail.com"  →  docId: "ongtrieuhau@gmail,com"
"hau@work.com"           →  docId: "hau@work,com"
```

```jsonc
// email_lookup/ongtrieuhau@gmail,com
{
  "email": "ongtrieuhau@gmail.com",
  "contactId": "uid_abc123",
  "isPrimary": false,
  "type": ["INTERNET", "HOME"],
  "label": "Cá nhân",
}
```

Mỗi email address = 1 document. 30K contacts × TB 1.8 email = **~54K docs** (~54KB tổng).

---

### 3.4 `ud_key_lookup/{keyId}` — [MỚI]

> Reverse lookup: biết userDefined key → ngay lập tức tất cả contactId có key đó.  
> **documentId = key với `.` thay bằng `,`**

```
"gitea.token"                     →  docId: "gitea,token"
"go.2Fa.Secret"                   →  docId: "go,2Fa,Secret"
"tailscale.com.TrustCredentials"  →  docId: "tailscale,com,TrustCredentials"
```

```jsonc
// ud_key_lookup/gitea,token
{
  "key":        "gitea.token",
  "contactIds": ["uid_abc123", "uid_def456", "uid_xyz789"],
  "count":      3,
  "updatedAt":  "2026-03-28T10:00:00Z"
}

// ud_key_lookup/go,2Fa,Secret
{
  "key":        "go.2Fa.Secret",
  "contactIds": ["uid_abc123", "uid_qqq111"],
  "count":      1250,
  "updatedAt":  "2026-03-28T10:00:00Z"
}
```

Số unique keys thực tế rất nhỏ (10–30 loại). Mỗi doc dưới 1MB Firestore limit ngay cả khi có 30K contactId trong array.

---

### 3.5 `categories/{categoryId}`

```jsonc
{
  "id": "cat_friends",
  "name": "friends",
  "displayName": "Bạn bè",
  "color": "#4A90D9",
  "count": 150,
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-03-28T10:00:00Z",
}
```

### 3.6 `meta/stats`

```jsonc
{
  "totalContacts": 30000,
  "lastUpdated": "2026-03-28T10:00:00Z",
  "lastImport": { "filename": "contacts_export_2026.vcf", "count": 29850, "errors": 12 },
  "domainCounts": { "gmail.com": 12000, "yahoo.com": 3500 },
  "categoryCounts": { "myContacts": 29000, "friends": 150 },
  "udKeyCounts": {
    "go.2Fa.Secret": 1250,
    "github.token": 800,
    "gitea.token": 320,
  },
}
```

---

## 4. Composite Indexes — `firestore.indexes.json`

```json
{
  "indexes": [
    {
      "collectionGroup": "contacts_index",
      "fields": [
        { "fieldPath": "searchTokens", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "contacts_index",
      "fields": [
        { "fieldPath": "categories", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "contacts_index",
      "fields": [
        { "fieldPath": "allEmails", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "contacts_index",
      "fields": [
        { "fieldPath": "allDomains", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "contacts_index",
      "fields": [
        { "fieldPath": "userDefinedKeys", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "contacts_index",
      "fields": [
        { "fieldPath": "categories", "arrayConfig": "CONTAINS" },
        { "fieldPath": "userDefinedKeys", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "contacts_index",
      "fields": [
        { "fieldPath": "emailDomain", "order": "ASCENDING" },
        { "fieldPath": "displayName", "order": "ASCENDING" }
      ]
    }
  ]
}
```

---

## 5. Query Patterns — tất cả use cases

### 5.1 Search & Filter trên `contacts_index`

```js
// [A] Danh sách thường — 50 reads/page
db.collection("contacts_index").orderBy("updatedAt", "desc").limit(50);

// [B] Search theo tên / org / email-local
db.collection("contacts_index").where("searchTokens", "array-contains", "joi").orderBy("updatedAt", "desc").limit(50);

// [C] Filter theo bất kỳ email nào của contact
db.collection("contacts_index").where("allEmails", "array-contains", "ongtrieuhau@gmail.com");

// [D] Filter theo domain
db.collection("contacts_index").where("allDomains", "array-contains", "gmail.com").orderBy("updatedAt", "desc").limit(50);

// [E] Tất cả contacts có key gitea.token
db.collection("contacts_index").where("userDefinedKeys", "array-contains", "gitea.token").orderBy("updatedAt", "desc").limit(50);

// [F] Combo: myContacts + có gitea.token
db.collection("contacts_index")
  .where("categories", "array-contains", "myContacts")
  .where("userDefinedKeys", "array-contains", "gitea.token")
  .orderBy("updatedAt", "desc")
  .limit(50);
```

### 5.2 Reverse lookup O(1)

```js
// Lookup theo email — 2 reads
async function getContactByEmail(email) {
  const docId = email.toLowerCase().replace(/\./g, ",");
  const lookup = await db.collection("email_lookup").doc(docId).get();
  if (!lookup.exists) return null;
  const { contactId, isPrimary } = lookup.data();
  const detail = await db.collection("contacts_detail").doc(contactId).get();
  return { contactId, isPrimary, ...detail.data() };
}

// Lookup tất cả contacts theo userDefined key — 1 + N reads
async function getContactsByUdKey(key) {
  const docId = key.replace(/\./g, ",");
  const lookup = await db.collection("ud_key_lookup").doc(docId).get();
  if (!lookup.exists) return { key, contacts: [], count: 0 };
  const { contactIds, count } = lookup.data();

  // getAll = 1 roundtrip, N reads
  const indexDocs = await db.getAll(...contactIds.map((id) => db.collection("contacts_index").doc(id)));
  return { key, count, contacts: indexDocs.filter((d) => d.exists).map((d) => d.data()) };
}
```

### 5.3 Xem chi tiết 1 contact

```js
async function getContactDetail(contactId) {
  const [indexDoc, detailDoc] = await db.getAll(db.collection("contacts_index").doc(contactId), db.collection("contacts_detail").doc(contactId));
  return { index: indexDoc.data(), detail: detailDoc.data() };
  // 2 reads
}
```

---

## 6. contactMapper.js — build tất cả docs trong 1 batch

```js
// utils/contactMapper.js
const { nanoid } = require("nanoid");

function buildContactDocs(contactJson, options = {}) {
  const contactId = options.contactId || nanoid();
  const now = new Date().toISOString();
  const { contact, userDefined = {} } = contactJson;

  // ── Emails ──────────────────────────────────────────────
  const emails = contact.emails || [];
  const allEmails = [...new Set(emails.map((e) => e.value.toLowerCase()))];
  const allDomains = [...new Set(allEmails.map((e) => e.split("@")[1]).filter(Boolean))];

  // ── userDefined keys ────────────────────────────────────
  const userDefinedKeys = Object.keys(userDefined);

  // ── Search tokens ────────────────────────────────────────
  const searchTokens = buildSearchTokens({
    displayName: contact.displayName || "",
    organization: contact.organization || "",
    primaryEmail: allEmails[0] || "",
  });

  // ── contacts_index ───────────────────────────────────────
  const indexDoc = {
    id: contactId,
    displayName: contact.displayName || "",
    nameNormalized: (contact.displayName || "").toLowerCase(),
    primaryEmail: allEmails[0] || "",
    emailDomain: allDomains[0] || "",
    allEmails,
    allDomains,
    primaryPhone: contact.phones?.[0]?.value || "",
    organization: contact.organization || "",
    photoUrl: contact.photo || "",
    categories: contact.categories || [],
    tags: [],
    searchTokens,
    userDefinedKeys,
    hasUserDefined: userDefinedKeys.length > 0,
    emailCount: allEmails.length,
    phoneCount: (contact.phones || []).length,
    udKeyCount: userDefinedKeys.length,
    createdAt: options.createdAt || now,
    updatedAt: now,
    importedAt: now,
    sourceFile: options.sourceFile || null,
    version: 1,
  };

  // ── contacts_detail ──────────────────────────────────────
  const detailDoc = {
    id: contactId,
    contact,
    userDefined,
    vcfRaw: options.vcfRaw || null,
    createdAt: options.createdAt || now,
    updatedAt: now,
    version: 1,
  };

  // ── email_lookup docs ────────────────────────────────────
  const emailLookupDocs = emails.map((emailObj, idx) => {
    const email = emailObj.value.toLowerCase();
    return {
      docId: email.replace(/\./g, ","),
      data: { email, contactId, isPrimary: idx === 0, type: emailObj.type || [], label: emailObj.label || null },
    };
  });

  // ── ud_key_lookup updates ─────────────────────────────────
  const udKeyUpdates = userDefinedKeys.map((key) => ({
    docId: key.replace(/\./g, ","),
    key,
    contactId,
  }));

  return { contactId, indexDoc, detailDoc, emailLookupDocs, udKeyUpdates };
}

function buildSearchTokens({ displayName, organization, primaryEmail }) {
  const set = new Set();
  const addPrefixes = (str) => {
    const words = str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    for (const word of words) {
      set.add(word);
      for (let i = 2; i < word.length; i++) set.add(word.slice(0, i));
    }
  };
  if (displayName) addPrefixes(displayName);
  if (organization) addPrefixes(organization);
  if (primaryEmail) addPrefixes(primaryEmail.split("@")[0]);
  return [...set];
}

module.exports = { buildContactDocs, buildSearchTokens };
```

---

## 7. writeContact.js — atomic batch write

```js
// utils/writeContact.js
const { db } = require("./firebase-admin");
const { buildContactDocs } = require("./contactMapper");
const { FieldValue } = require("firebase-admin/firestore");

async function writeContact(contactJson, options = {}) {
  const { contactId, indexDoc, detailDoc, emailLookupDocs, udKeyUpdates } = buildContactDocs(contactJson, options);

  const batch = db.batch();

  batch.set(db.collection("contacts_index").doc(contactId), indexDoc);
  batch.set(db.collection("contacts_detail").doc(contactId), detailDoc);

  for (const { docId, data } of emailLookupDocs) {
    batch.set(db.collection("email_lookup").doc(docId), data);
  }

  for (const { docId, key, contactId: cid } of udKeyUpdates) {
    batch.set(
      db.collection("ud_key_lookup").doc(docId),
      { key, contactIds: FieldValue.arrayUnion(cid), count: FieldValue.increment(1), updatedAt: new Date().toISOString() },
      { merge: true },
    );
  }

  await batch.commit();
  return contactId;
}

async function deleteContact(contactId) {
  const indexDoc = await db.collection("contacts_index").doc(contactId).get();
  if (!indexDoc.exists) throw new Error(`Not found: ${contactId}`);
  const { allEmails, userDefinedKeys } = indexDoc.data();

  const batch = db.batch();
  batch.delete(db.collection("contacts_index").doc(contactId));
  batch.delete(db.collection("contacts_detail").doc(contactId));

  for (const email of allEmails) {
    batch.delete(db.collection("email_lookup").doc(email.replace(/\./g, ",")));
  }
  for (const key of userDefinedKeys) {
    batch.set(
      db.collection("ud_key_lookup").doc(key.replace(/\./g, ",")),
      { contactIds: FieldValue.arrayRemove(contactId), count: FieldValue.increment(-1), updatedAt: new Date().toISOString() },
      { merge: true },
    );
  }
  await batch.commit();
}

module.exports = { writeContact, deleteContact };
```

---

## 8. REST API Endpoints

| Method | Path                        | Mô tả                           | Reads      |
| ------ | --------------------------- | ------------------------------- | ---------- |
| GET    | `/contacts`                 | Danh sách + filter + search     | 50/page    |
| GET    | `/contacts/:id`             | Chi tiết 1 contact              | 2          |
| POST   | `/contacts`                 | Tạo mới                         | 2+N writes |
| PUT    | `/contacts/:id`             | Cập nhật toàn bộ                | 2+N writes |
| PATCH  | `/contacts/:id`             | Cập nhật từng phần              | 2+N writes |
| DELETE | `/contacts/:id`             | Xóa                             | 2+N writes |
| GET    | `/contacts/by-email/:email` | Tra ngược theo email            | 3          |
| GET    | `/contacts/by-ud-key/:key`  | Tất cả contacts có key          | 1+N        |
| GET    | `/contacts/ud-keys`         | Liệt kê tất cả userDefined keys | ~10–30     |
| POST   | `/contacts/bulk/import`     | Bulk import (async)             | N writes   |
| GET    | `/contacts/bulk/export`     | Export JSON/VCF                 | N reads    |
| GET    | `/contacts/meta/stats`      | Thống kê tổng                   | 1          |

### GET `/contacts` — query params

```
search      string   prefix search (min 2 chars)
category    string   filter by category
domain      string   filter by email domain (gmail.com)
email       string   filter contacts có email này
udKey       string   filter contacts có userDefined key này
hasUD       boolean  chỉ lấy contacts có userDefined
sort        string   updatedAt | createdAt | displayName
order       string   asc | desc
limit       number   default 50, max 200
cursor      string   cursor pagination
```

### GET `/contacts/by-ud-key/:key` — response

```jsonc
// GET /contacts/by-ud-key/gitea.token
{
  "key": "gitea.token",
  "count": 3,
  "contacts": [
    {
      "contactId": "uid_abc123",
      "displayName": "John Doe",
      "primaryEmail": "hau@work.com",
      "allEmails": ["hau@work.com", "ongtrieuhau@gmail.com"],
      "udValue": "gta_yyy", // có nếu ?includeValue=true
    },
  ],
}
```

### GET `/contacts/ud-keys` — response

```jsonc
{
  "keys": [
    { "key": "go.2Fa.Secret", "count": 1250 },
    { "key": "github.token", "count": 800 },
    { "key": "gitea.token", "count": 320 },
    { "key": "tailscale.com.TrustCredentials", "count": 45 },
  ],
}
```

---

## 9. Migration Script — update 30K contacts hiện có

```js
// scripts/migrate-v2.js — chạy 1 lần
const { db } = require("./firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

async function migrate() {
  let cursor = null,
    total = 0,
    errors = 0;
  console.log("Starting migration v2...");

  do {
    let q = db.collection("contacts_detail").orderBy("createdAt").limit(400);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    cursor = snap.docs.at(-1);

    const batch = db.batch();

    for (const doc of snap.docs) {
      try {
        const { contact = {}, userDefined = {}, id: contactId } = doc.data();
        const emails = contact.emails || [];
        const allEmails = [...new Set(emails.map((e) => e.value.toLowerCase()))];
        const allDomains = [...new Set(allEmails.map((e) => e.split("@")[1]).filter(Boolean))];
        const udKeys = Object.keys(userDefined);

        // Update contacts_index
        batch.update(db.collection("contacts_index").doc(contactId), {
          allEmails,
          allDomains,
          userDefinedKeys: udKeys,
          hasUserDefined: udKeys.length > 0,
          udKeyCount: udKeys.length,
          emailCount: allEmails.length,
        });

        // Create email_lookup
        emails.forEach((e, idx) => {
          const email = e.value.toLowerCase();
          batch.set(db.collection("email_lookup").doc(email.replace(/\./g, ",")), {
            email,
            contactId,
            isPrimary: idx === 0,
            type: e.type || [],
            label: e.label || null,
          });
        });

        // Create/update ud_key_lookup
        udKeys.forEach((key) => {
          batch.set(
            db.collection("ud_key_lookup").doc(key.replace(/\./g, ",")),
            { key, contactIds: FieldValue.arrayUnion(contactId), count: FieldValue.increment(1), updatedAt: new Date().toISOString() },
            { merge: true },
          );
        });
        total++;
      } catch (err) {
        console.error(`  Error ${doc.id}:`, err.message);
        errors++;
      }
    }

    await batch.commit();
    process.stdout.write(`\r  ${total} contacts, ${errors} errors`);
  } while (cursor);

  console.log(`\nDone: ${total} updated, ${errors} errors`);
}

migrate().catch(console.error);
```

---

## 10. Bảng tra cứu nhanh

| Bạn muốn...                     | Collection        | Method                               | Reads     |
| ------------------------------- | ----------------- | ------------------------------------ | --------- |
| Hiện danh sách contacts         | `contacts_index`  | paginate                             | 50/page   |
| Tìm theo tên/org                | `contacts_index`  | `searchTokens array-contains`        | 50/page   |
| Filter theo category            | `contacts_index`  | `categories array-contains`          | 50/page   |
| Filter có udKey nào đó          | `contacts_index`  | `userDefinedKeys array-contains`     | 50/page   |
| Combo category + udKey          | `contacts_index`  | 2 `array-contains` + composite index | 50/page   |
| Filter theo domain email        | `contacts_index`  | `allDomains array-contains`          | 50/page   |
| Tìm email phụ                   | `contacts_index`  | `allEmails array-contains`           | 50/page   |
| **Email → contact (O1)**        | `email_lookup`    | `.doc(emailId).get()`                | **2**     |
| **udKey → tất cả contact (O1)** | `ud_key_lookup`   | `.doc(keyId).get()`                  | **1 + N** |
| Liệt kê tất cả udKey            | `ud_key_lookup`   | `.get()`                             | ~10–30    |
| Xem chi tiết 1 contact          | `contacts_detail` | `.doc(id).get()`                     | 1         |
| Thống kê tổng                   | `meta/stats`      | `.doc('stats').get()`                | 1         |

---

## 11. Ước tính chi phí Firestore

**Session 30 phút bình thường:**

```
Load lần đầu (page 1):   50 reads
Scroll 4 trang:          200 reads
Search 3 lần:            150 reads
Xem chi tiết 5 contacts:  10 reads
Lookup 2 email:            6 reads
Lookup 1 udKey (3 hits):   4 reads
─────────────────────────────────
Tổng session:           ~420 reads  ←  trước đây: 30.000 reads/lần load
```

Nằm trong free tier Firestore (50K reads/ngày) thoải mái cho dùng cá nhân.

---

## 12. Cấu trúc project

```
contacts-selfhost/
├── functions/
│   ├── index.js
│   ├── routes/
│   │   ├── contacts.js      # CRUD + search
│   │   ├── lookup.js        # /by-email, /by-ud-key, /ud-keys  [MỚI]
│   │   ├── bulk.js          # import / export
│   │   └── meta.js          # stats, categories
│   ├── middleware/auth.js
│   └── utils/
│       ├── contactMapper.js  # buildContactDocs()
│       ├── writeContact.js   # writeContact(), deleteContact()
│       ├── searchTokens.js
│       └── pagination.js
│
├── scripts/
│   ├── vcf2json.js
│   ├── import.js
│   ├── export.js
│   └── migrate-v2.js        # [MỚI] chạy 1 lần để add allEmails/userDefinedKeys
│
├── firestore.rules
├── firestore.indexes.json
├── database.rules.json
└── firebase.json
```
