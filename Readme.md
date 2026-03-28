# Self-hosted Contact Manager

> Quản lý danh bạ cá nhân với ~30,000 contacts  
> Firebase Firestore + Realtime Database + REST API
> repo-name: o-contact-manager

---

## Tính năng

- 📋 Quản lý 30,000+ contacts với hiệu năng cao
- 🔍 Tìm kiếm prefix real-time (tên, tổ chức, email)
- 📧 Tìm kiếm theo bất kỳ email nào (primary hoặc phụ)
- 🔑 Lưu trữ & tìm kiếm theo userDefined keys (2FA secrets, tokens,...)
- 🏷️ Phân loại theo categories/tags
- 📥 Import từ VCF (vCard)
- 📤 Export JSON/VCF
- 🔒 API Key authentication
- 💰 Tối ưu Firestore quota (50 reads/page thay vì 30,000)

---

## Kiến trúc

```
Firestore
├── contacts_index/{id}     ← list, search, filter (~1KB/doc)
├── contacts_detail/{id}    ← full data on-demand (~5-50KB/doc)
├── email_lookup/{emailId}  ← O(1) reverse lookup by email
├── ud_key_lookup/{keyId}   ← O(1) reverse lookup by userDefined key
├── categories/{id}         ← tag management
└── meta/stats              ← global stats

Realtime Database
├── /api_keys/{keyHash}     ← API key management
├── /sync_status            ← sync status
└── /import_jobs/{jobId}    ← bulk import progress
```

Chi tiết đầy đủ: [`docs/database-architecture.md`](docs/database-architecture.md)

---

## Yêu cầu

- Node.js >= 18
- Firebase project với Firestore và Realtime Database enabled
- Firebase service account key (JSON)
- Firebase CLI: `npm install -g firebase-tools`

---

## Cài đặt

### 1. Chuẩn bị Firebase project

1. Truy cập [Firebase Console](https://console.firebase.google.com)
2. Tạo project mới hoặc dùng project có sẵn
3. Bật **Firestore Database** (chọn Native mode)
4. Bật **Realtime Database**
5. Vào **Project Settings → Service accounts → Generate new private key**
6. Tải file JSON về và đặt tên `serviceAccountKey.json`

### 2. Clone & cài đặt

```bash
# Clone project
git clone <repo-url>
cd contacts-selfhost

# Cài dependencies
npm install

# Cấu hình môi trường
cp .env.example .env
```

### 3. Sửa file `.env`

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
PORT=3000
NODE_ENV=development
```

### 4. Deploy Firestore rules & indexes

```bash
firebase login
firebase use your-firebase-project-id

npm run deploy:rules
# hoặc: firebase deploy --only firestore:rules,firestore:indexes
```

### 5. Tạo API key đầu tiên

```bash
node scripts/create-api-key.js
# → Sẽ in ra API key, lưu lại để dùng trong header Authorization
```

### 6. Chạy server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Server chạy tại: `http://localhost:3000`

---

## Import Contacts

```bash
# Import từ file VCF
npm run import -- --file contacts_export.vcf

# Migration nếu đã có data cũ (chạy 1 lần)
npm run migrate
```

---

## API Reference

Tất cả requests cần header: `Authorization: Bearer <api-key>`

### Endpoints

| Method | Path                        | Mô tả                           |
| ------ | --------------------------- | ------------------------------- |
| GET    | `/health`                   | Health check                    |
| GET    | `/contacts`                 | Danh sách + search + filter     |
| GET    | `/contacts/:id`             | Chi tiết 1 contact              |
| POST   | `/contacts`                 | Tạo mới                         |
| PUT    | `/contacts/:id`             | Cập nhật toàn bộ                |
| PATCH  | `/contacts/:id`             | Cập nhật từng phần              |
| DELETE | `/contacts/:id`             | Xóa                             |
| GET    | `/contacts/by-email/:email` | Lookup theo email               |
| GET    | `/contacts/by-ud-key/:key`  | Lookup theo userDefined key     |
| GET    | `/contacts/ud-keys`         | Liệt kê tất cả userDefined keys |
| POST   | `/contacts/bulk/import`     | Bulk import (async)             |
| GET    | `/contacts/bulk/export`     | Export JSON/VCF                 |
| GET    | `/contacts/meta/stats`      | Thống kê tổng                   |

### Query params cho GET `/contacts`

```
search      string   tìm kiếm (min 2 ký tự)
category    string   lọc theo category
domain      string   lọc theo email domain (vd: gmail.com)
email       string   lọc theo email cụ thể
udKey       string   lọc theo userDefined key
hasUD       boolean  chỉ lấy contacts có userDefined
sort        string   updatedAt | createdAt | displayName
order       string   asc | desc
limit       number   default 50, max 200
cursor      string   cursor để phân trang
```

Xem ví dụ chi tiết: [`docs/api.http`](docs/api.http)

---

## Chi phí Firestore (ước tính)

| Hoạt động       | Reads    | Ghi chú                    |
| --------------- | -------- | -------------------------- |
| Load trang đầu  | 50       | Pagination 50/trang        |
| Tìm kiếm        | 50/trang | Dùng searchTokens index    |
| Xem chi tiết    | 2        | index + detail             |
| Lookup email    | 2        | O(1)                       |
| Lookup udKey    | 1+N      | N = số contacts có key đó  |
| Session 30 phút | ~420     | Trước đây: 30,000/lần load |

---

## Trạng thái phát triển

| Nhóm                 | Tasks           | Trạng thái    |
| -------------------- | --------------- | ------------- |
| A — Foundation       | TASK-01, 02, 03 | ✅ Hoàn thành |
| B — Core Utils       | TASK-04, 05, 06 | 🔲 Chưa làm   |
| C — API Routes       | TASK-07, 08, 09 | 🔲 Chưa làm   |
| D — Middleware       | TASK-10, 11     | 🔲 Chưa làm   |
| E — Scripts          | TASK-12, 13, 14 | 🔲 Chưa làm   |
| F — Testing & Deploy | TASK-15, 16     | 🔲 Chưa làm   |

Xem chi tiết: [`project_task.md`](project_task.md)

---

## Changelog

Xem: [`CHANGE_LOGS_USER.md`](CHANGE_LOGS_USER.md)
