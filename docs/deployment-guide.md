# Deployment Guide — Self-hosted Contact Manager

> Hướng dẫn deploy production từng bước  
> Hai lựa chọn: **Self-hosted (Node.js)** hoặc **Firebase Cloud Functions**

---

## Lựa chọn A — Self-hosted (Node.js + PM2) ✅ Khuyến nghị

Chạy Express server trực tiếp trên VPS/server của bạn. Không cần Firebase Functions billing.

### Bước 1 — Chuẩn bị server

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y nodejs npm

# Kiểm tra version (cần >= 18)
node --version

# Cài PM2 (process manager)
npm install -g pm2
```

### Bước 2 — Upload code lên server

```bash
# Từ máy local — copy project lên server
scp -r ./contacts-selfhost user@your-server:/opt/contacts-selfhost

# Hoặc clone từ git
git clone <repo-url> /opt/contacts-selfhost
cd /opt/contacts-selfhost
npm install --omit=dev
```

### Bước 3 — Cấu hình môi trường

```bash
cd /opt/contacts-selfhost
cp .env.example .env
nano .env
```

Điền đúng các giá trị:

```env
FIREBASE_PROJECT_ID=your-actual-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=/opt/contacts-selfhost/serviceAccountKey.json
PORT=3000
NODE_ENV=production
CORS_ORIGINS=https://contacts.yourdomain.com
```

Upload `serviceAccountKey.json`:
```bash
# Từ máy local
scp ./serviceAccountKey.json user@your-server:/opt/contacts-selfhost/serviceAccountKey.json

# Bảo vệ file key
chmod 600 /opt/contacts-selfhost/serviceAccountKey.json
```

### Bước 4 — Deploy Firestore rules & indexes

```bash
# Cài Firebase CLI nếu chưa có
npm install -g firebase-tools

# Login và set project
firebase login
firebase use your-firebase-project-id

# Deploy rules + indexes (chỉ cần làm 1 lần, hoặc khi thay đổi)
npm run deploy:rules
# hoặc: firebase deploy --only firestore:rules,firestore:indexes
```

Chờ ~1-2 phút để indexes build xong. Kiểm tra tại Firebase Console → Firestore → Indexes.

### Bước 5 — Tạo API key đầu tiên

```bash
cd /opt/contacts-selfhost
node scripts/create-api-key.js --name "Admin"

# Output:
# ✅ API key created successfully!
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#   Name:       Admin
#   Key:        <43-char-key>
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ⚠️  Copy this key now — it will NOT be shown again.
```

**Lưu key này ngay** — không thể recover.

### Bước 6 — Import contacts (nếu có data)

```bash
# Import từ VCF
npm run import -- --file /path/to/contacts.vcf

# Migration nếu đã có data cũ trong Firestore (chỉ chạy 1 lần)
npm run migrate

# Dry-run trước để kiểm tra
node scripts/migrate-v2.js --dry-run
```

### Bước 7 — Khởi động với PM2

```bash
cd /opt/contacts-selfhost

# Tạo ecosystem file cho PM2
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'contact-manager',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_file: '.env',
    log_file: '/var/log/contact-manager/combined.log',
    out_file: '/var/log/contact-manager/out.log',
    error_file: '/var/log/contact-manager/error.log',
    time: true
  }]
};
EOF

mkdir -p /var/log/contact-manager

# Khởi động
pm2 start ecosystem.config.js

# Auto-start khi reboot
pm2 save
pm2 startup
# → Chạy lệnh được in ra

# Kiểm tra status
pm2 status
pm2 logs contact-manager
```

### Bước 8 — Test end-to-end

```bash
# Health check
curl http://localhost:3000/health
# → {"status":"ok","version":"1.0.0","timestamp":"..."}

# List contacts (cần API key)
curl -H "Authorization: Bearer <your-api-key>" http://localhost:3000/contacts
# → {"data":[],"meta":{"count":0,...}}

# Stats
curl -H "Authorization: Bearer <your-api-key>" http://localhost:3000/contacts/meta/stats
```

### Bước 9 — Nginx reverse proxy (optional, khuyến nghị)

```nginx
# /etc/nginx/sites-available/contacts
server {
    listen 80;
    server_name contacts.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
        client_max_body_size 20M;  # cho bulk import
    }
}
```

```bash
ln -s /etc/nginx/sites-available/contacts /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# HTTPS với Let's Encrypt
certbot --nginx -d contacts.yourdomain.com
```

---

## Lựa chọn B — Firebase Cloud Functions

Phù hợp nếu muốn serverless, không cần quản lý server.

### Bước 1 — Sửa `firebase.json`

```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs18"
  }
}
```

### Bước 2 — Wrap Express app cho Cloud Functions

Thêm vào cuối `functions/index.js`:

```js
const functions = require('firebase-functions');
exports.api = functions.https.onRequest(app);
```

Cài thêm dependency:
```bash
npm install firebase-functions
```

### Bước 3 — Deploy

```bash
firebase deploy --only functions
# → https://us-central1-YOUR-PROJECT.cloudfunctions.net/api
```

### Lưu ý về Cloud Functions

- Cold start có thể chậm ~2-3s
- Billing theo số requests (free tier: 2M req/month)
- Không cần quản lý server, tự scale
- `PORT` env var không dùng được (Cloud Functions tự quản lý)

---

## Checklist Production

```
□ Firestore rules đã deploy (contacts không accessible từ client)
□ Realtime DB rules đã deploy (api_keys không readable)
□ Firestore indexes đã build xong (kiểm tra Firebase Console)
□ serviceAccountKey.json đã upload và chmod 600
□ .env đã cấu hình đúng FIREBASE_PROJECT_ID
□ API key đầu tiên đã tạo và lưu lại
□ Health check trả về 200
□ GET /contacts trả về đúng (dù empty)
□ PM2 đã save + startup configured
□ Log rotation đã setup (logrotate hoặc PM2 built-in)
```

---

## Quản lý API Keys

```bash
# Tạo key mới cho một app
node scripts/create-api-key.js --name "Mobile App"

# Tạo key có hạn sử dụng
node scripts/create-api-key.js --name "CI Bot" --expires 2027-01-01

# Vô hiệu hóa key (không xóa — giữ audit trail)
# Vào Firebase Console → Realtime Database → api_keys/{keyHash} → set active: false

# Liệt kê keys (xem hash prefix để identify)
# Firebase Console → Realtime Database → api_keys
```

---

## Monitoring & Maintenance

```bash
# Xem logs real-time
pm2 logs contact-manager

# Xem metrics
pm2 monit

# Restart nếu cần
pm2 restart contact-manager

# Cập nhật code
cd /opt/contacts-selfhost
git pull
npm install --omit=dev
pm2 restart contact-manager

# Backup Firestore (dùng Firebase CLI)
gcloud firestore export gs://your-bucket/backups/$(date +%Y%m%d)
```

---

## Xử lý sự cố thường gặp

| Vấn đề | Nguyên nhân | Cách xử lý |
|--------|-------------|------------|
| 401 Unauthorized | Key sai hoặc header format sai | Dùng đúng `Authorization: Bearer <key>` |
| 403 Forbidden | Key đã disabled hoặc hết hạn | Tạo key mới hoặc set active: true |
| Query chậm | Index chưa build xong | Chờ Firebase Console báo "Enabled" |
| Import timeout | Concurrency quá cao | Giảm `--concurrency` xuống 3-5 |
| Firestore quota | Đọc nhiều hơn 50K/ngày | Tăng limit hoặc upgrade Firebase plan |
| PATCH mất data | Body không đủ fields | PATCH merge vào existing — chỉ cần gửi fields cần thay |
