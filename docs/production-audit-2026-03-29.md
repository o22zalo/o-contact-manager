# Production Audit Report (2026-03-29)

- Auditor: GPT-5.3-Codex
- Scope: toàn bộ mã nguồn và cấu hình trong repo `o-contact-manager`
- Kết luận sơ bộ: **NOT READY**

## Key blockers trước deploy

1. `firebase.json` khai báo deploy Cloud Functions từ thư mục `functions`, nhưng repo hiện chỉ có `src/` và không có thư mục `functions`.
2. Tài liệu deploy PM2 trong `docs/deployment-guide.md` tạo config chạy `functions/index.js`, path này không tồn tại.
3. API trả lỗi 500 kèm `err.message` ở production (rò rỉ thông tin nội bộ).
4. CORS đang mở toàn bộ (`app.use(cors())`) cho API key-based backend.
5. Thiếu lockfile (`package-lock.json`), không đảm bảo build reproducible/supply-chain scanning.

## Validation commands executed

- `npm test` ✅
- `npm run lint` ✅
- `npm audit --json` ❌ (failed due missing lockfile)
