# Báo cáo tương thích Frontend ↔ Backend (2026-03-29)

## 1) Phạm vi kiểm tra

- Frontend: `src-frontend` (React + Vite + Axios + React Query).
- Backend: `src` (Express + Firebase Admin).
- Mục tiêu: xác nhận readiness tổng thể để đưa production và độ khớp contract API.

## 2) Kết quả tổng thể

**Kết luận:** Có thể triển khai production theo mô hình self-hosted, nhưng nên xử lý các mục cải tiến vận hành trước khi go-live chính thức (đặc biệt readiness check và CI/CD gate).

- Frontend build được, có lint/type-check scripts.
- Backend có health endpoint, auth middleware, route tách rõ.
- Contract endpoint chính đã khớp giữa frontend và backend.

## 3) Ma trận tương thích endpoint

| Use case | Frontend gọi | Backend cung cấp | Kết quả |
|---|---|---|---|
| Health | `GET /health` | `GET /health` | ✅ Khớp |
| List contacts | `GET /contacts` | `GET /contacts` | ✅ Khớp |
| Contact detail | `GET /contacts/:id` | `GET /contacts/:id` | ✅ Khớp |
| Create contact | `POST /contacts` | `POST /contacts` | ✅ Khớp |
| Update (PUT/PATCH) | `PUT/PATCH /contacts/:id` | `PUT/PATCH /contacts/:id` | ✅ Khớp |
| Delete contact | `DELETE /contacts/:id` | `DELETE /contacts/:id` | ✅ Khớp |
| Lookup email | `GET /contacts/by-email/:email` | `GET /contacts/by-email/:email` | ✅ Khớp |
| Lookup UD key | `GET /contacts/by-ud-key/:key` | `GET /contacts/by-ud-key/:key` | ✅ Khớp |
| UD keys | `GET /contacts/ud-keys` | `GET /contacts/ud-keys` | ✅ Khớp |
| Stats | `GET /contacts/meta/stats` | `GET /contacts/meta/stats` | ✅ Khớp |
| Bulk import | `POST /contacts/bulk/import` | `POST /contacts/bulk/import` | ✅ Khớp |
| Bulk import status | `GET /contacts/bulk/import/:jobId` | `GET /contacts/bulk/import/:jobId` | ✅ Khớp |
| Bulk export | `GET /contacts/bulk/export` | `GET /contacts/bulk/export` | ✅ Khớp |

## 4) Nhận xét readiness frontend

### Điểm tốt
- Có cấu hình runtime API URL qua Settings + fallback `VITE_API_BASE_URL`.
- PWA assets và flow build chuẩn Vite.
- Cấu trúc API module rõ ràng, tách `contacts/lookup/bulk/meta`.

### Điểm cần lưu ý trước production
1. Cần khóa domain CORS đúng production (`CORS_ORIGINS`) để tránh open CORS.
2. Cần health/readiness rõ hơn ở backend để frontend không nhận false-green.
3. Khuyến nghị thiết lập observability (Dozzle/Portainer + log disk + alert cơ bản).

## 5) Nhận xét tương thích dữ liệu

- Frontend đã xử lý API envelope dạng `{ data, meta }` ở các hàm ghi/xóa contact.
- Frontend giữ timeout 30s và có thông báo mạng thân thiện khi backend không phản hồi.
- Cơ chế auth `Authorization: Bearer <apiKey>` tương thích với middleware backend.

## 6) Rủi ro và khuyến nghị triển khai

### Rủi ro còn lại
- Rate-limit backend đang in-memory (không bền vững khi scale ngang).
- Bulk import dạng process-local background task, chưa có queue durable.

### Khuyến nghị
- Giai đoạn demo: chấp nhận với giới hạn tải vừa phải.
- Giai đoạn production thật: chuyển queue durable + external rate limiting (Redis/edge).

## 7) Trạng thái hành động

- [x] Đánh giá contract API frontend/backend
- [x] Đề xuất kiến trúc triển khai cùng máy
- [x] Bổ sung phương án Docker all-in-one + services hỗ trợ vận hành
- [x] Bổ sung mẫu pipeline GitHub Actions + Azure Pipelines cho demo
