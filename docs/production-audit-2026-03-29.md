# Production Audit Report (2026-03-29)

- Auditor: GPT-5.3-Codex
- Scope: toàn bộ code/config trong repo `o-contact-manager`
- Overall: **READY WITH FIXES** (assumption: deploy theo mô hình Node.js self-hosted, **không** deploy Firebase Cloud Functions) (không nên deploy production trước khi xử lý các mục Critical/High)

## I. Executive Summary

### Production readiness verdict
**READY WITH FIXES**

### Top 5 rủi ro lớn nhất
1. **Memory DoS từ rate limiter in-memory không có cleanup**, có thể tăng RAM không giới hạn theo số IP. (`src/index.js`)
2. **Không có cơ chế background job bền vững cho bulk import** (fire-and-forget trong process), restart giữa chừng có thể để job kẹt `running` và dữ liệu ở trạng thái partial. (`src/routes/bulk.js`)
3. **Thiếu readiness/liveness thực sự + health check không kiểm tra Firebase**, dẫn đến deploy “green” giả nhưng service thao tác thật vẫn fail. (`src/index.js`, `scripts/health-check.js`)
4. **Thiếu CI/CD pipeline trong repo** (không có `.github/workflows` hoặc tương đương), không có gate bắt buộc cho lint/test/security scan trước deploy.
5. **Thiếu chuẩn vận hành production quan trọng**: không có `.env.example`, không có runbook rollback/migration ownership rõ ràng, logging chưa structured/correlation đầy đủ.


### Phạm vi triển khai dùng cho audit
- Audit này giả định mô hình triển khai chính là **Node.js self-hosted + PM2 + Nginx**.
- Các điểm liên quan Firebase Cloud Functions **không được coi là blocker deploy** cho scope hiện tại.
- Do đó, các nhận định cũ kiểu “thiếu thư mục `functions/`” hoặc “PM2 phải chạy `functions/index.js`” đã được loại khỏi danh sách blocker.

### Nhận định ngắn
Hệ thống có nền tảng backend rõ ràng (Express + Firestore + RTDB), có auth API key, phân tách index/detail hợp lý cho hiệu năng đọc. Tuy nhiên mức production-grade còn thiếu ở vận hành (observability, rollback discipline, CI/CD), durability của bulk job, và một số điểm an toàn runtime.

## II. Architecture Understanding

- **Loại hệ thống**: REST API quản lý danh bạ self-hosted.
- **Stack chính**: Node.js 18+, Express, Firebase Admin SDK (Firestore + Realtime DB), PM2 runtime.
- **Entrypoint**: `src/index.js` mount middleware + routes.
- **Data model**:
  - Firestore: `contacts_index`, `contacts_detail`, `email_lookup`, `ud_key_lookup`, `meta`.
  - Realtime DB: `api_keys`, `import_jobs`.
- **Request flow chuẩn**:
  - Client -> Express middleware (CORS, body parser, rate-limit, request-id) -> auth middleware (`/contacts`) -> route handlers -> Firestore/RTDB.
- **Deploy target dự kiến**: VM/VPS chạy PM2 + reverse proxy Nginx (theo tài liệu deployment).

## III. Findings by Severity

## Critical

### 1) In-memory rate limiter có thể gây memory leak/DoS theo thời gian
- **Severity**: Critical
- **Where**: `src/index.js`
- **Problem**:
  - `requestBuckets` là `Map` global tăng theo IP và **không có cleanup/TTL sweep**.
  - Chỉ reset counter theo key đã tồn tại, nhưng không xóa key cũ.
- **Why it matters in production**:
  - Attacker có thể spam nhiều IP spoofed/unique source qua proxy -> RAM tăng dần -> OOM/restart -> downtime.
- **Recommended fix**:
  - Dùng rate limiter production-grade (Redis-backed) hoặc ít nhất set interval cleanup key quá hạn.
  - Kết hợp reverse proxy/WAF rate limit tầng edge.
- **How to verify after fix**:
  - Load test 1M request từ nhiều IP giả lập; theo dõi heap usage ổn định, không tăng tuyến tính theo số IP.

## High

### 2) Bulk import xử lý async “fire-and-forget” không durable
- **Severity**: High
- **Where**: `src/routes/bulk.js`
- **Problem**:
  - Endpoint trả `202` rồi chạy IIFE async trong cùng process.
  - Nếu process crash/redeploy giữa chừng, job có thể dở dang, trạng thái RTDB không phản ánh chính xác.
- **Why it matters in production**:
  - Gây dữ liệu partial, người vận hành khó biết job nào cần resume/retry, tăng rủi ro sai lệch dữ liệu.
- **Recommended fix**:
  - Chuyển sang queue bền vững (Cloud Tasks/BullMQ/PubSub) + worker idempotent + checkpoint.
  - Tạo watchdog đánh dấu timeout jobs (`running` quá SLA -> `failed`).
- **How to verify after fix**:
  - Chạy import lớn, kill process giữa chừng, đảm bảo job được retry/resume và trạng thái cuối cùng nhất quán.

### 3) Thiếu CI/CD pipeline bắt buộc trước deploy
- **Severity**: High
- **Where**: repo root (không tìm thấy `.github/workflows` hoặc pipeline config tương đương)
- **Problem**:
  - Không có kiểm soát tự động lint/test/security scan/build artifact trước deploy.
- **Why it matters in production**:
  - Regression hoặc lỗ hổng có thể lên production trực tiếp; khó đảm bảo reproducibility.
- **Recommended fix**:
  - Thêm pipeline tối thiểu: install, lint, test, dependency audit (hoặc SCA thay thế), package/build + artifact digest.
- **How to verify after fix**:
  - Mở PR với lỗi lint/test và xác nhận pipeline block merge/deploy.

### 4) Health endpoint chỉ “process alive”, không phải readiness thực
- **Severity**: High
- **Where**: `src/index.js`, `scripts/health-check.js`
- **Problem**:
  - `/health` chỉ trả static status/version/timestamp, không check Firestore/RTDB.
  - Script health-check suy luận Firebase connectivity gián tiếp, không có readiness contract chính thức.
- **Why it matters in production**:
  - Rollout có thể pass health nhưng request thật fail khi Firebase credential/network lỗi.
- **Recommended fix**:
  - Tách `liveness` (process up) và `readiness` (Firestore/RTDB ping timeout ngắn).
  - Gate traffic dựa trên readiness.
- **How to verify after fix**:
  - Ngắt quyền service account/network Firebase, readiness phải fail nhanh và rollout dừng.

## Medium

### 5) Rate limit theo `req.ip` chưa cấu hình `trust proxy`
- **Severity**: Medium
- **Where**: `src/index.js`
- **Problem**:
  - Sau reverse proxy (Nginx), nếu không `app.set('trust proxy', 1)`, `req.ip` có thể thành IP proxy.
- **Why it matters in production**:
  - Tất cả user chia sẻ cùng bucket -> false positive 429; hoặc logic IP không đúng.
- **Recommended fix**:
  - Bật `trust proxy` đúng topology và validate `X-Forwarded-For` tại ingress.
- **How to verify after fix**:
  - Test qua Nginx với nhiều client IP, xác nhận bucket tách biệt đúng.

### 6) Logging chưa structured, thiếu telemetry chuẩn production
- **Severity**: Medium
- **Where**: toàn bộ routes + middleware
- **Problem**:
  - Log dùng `console.*`, format không chuẩn JSON; không có log fields thống nhất (latency, route, status, principal).
- **Why it matters in production**:
  - Khó query/analyze khi incident; khó tích hợp SIEM/APM.
- **Recommended fix**:
  - Dùng pino/winston structured logs + middleware access log + requestId xuyên suốt.
- **How to verify after fix**:
  - Kiểm tra log aggregator có thể filter theo `requestId`, `route`, `statusCode`, `durationMs`.

### 7) Data consistency của `ud_key_lookup.count` có nguy cơ drift
- **Severity**: Medium
- **Where**: `src/utils/writeContact.js`
- **Problem**:
  - `count` được tăng/giảm bằng `FieldValue.increment` tách rời khỏi truth source `contactIds` array, không có reconciler định kỳ.
- **Why it matters in production**:
  - Retry/replay/legacy bug có thể làm `count` lệch so với số phần tử thực, ảnh hưởng thống kê/filter.
- **Recommended fix**:
  - Dùng `count = contactIds.length` trong job reconcile định kỳ hoặc bỏ field `count` nếu không cần mạnh.
- **How to verify after fix**:
  - Chạy script reconcile trên dataset lớn, assert `count === contactIds.length` cho mọi doc.

### 8) Security headers mới ở mức cơ bản
- **Severity**: Medium
- **Where**: `src/index.js`
- **Problem**:
  - Có `nosniff`, `X-Frame-Options`, `Referrer-Policy` nhưng thiếu CSP/HSTS/Permissions-Policy.
- **Why it matters in production**:
  - Tăng bề mặt tấn công trên các deployment public qua browser clients.
- **Recommended fix**:
  - Dùng `helmet` với policy phù hợp API context.
- **How to verify after fix**:
  - Kiểm tra response headers đầy đủ qua curl/security scanner.

## Low

### 9) Documentation chưa đồng bộ hoàn toàn về vận hành
- **Severity**: Low
- **Where**: `Readme.md`, `docs/deployment-guide.md`
- **Problem**:
  - Tài liệu đề cập `.env.example` nhưng repo chưa có file này.
  - Chưa có runbook chi tiết cho rollback schema/data khi migration thất bại.
- **Why it matters in production**:
  - Onboarding và thao tác sự cố dễ sai sót.
- **Recommended fix**:
  - Bổ sung `.env.example` + runbook rollback/restore/secret rotation.
- **How to verify after fix**:
  - Engineer mới có thể dựng staging từ docs mà không cần hỏi thêm.

### 10) `npm audit` không chạy được trong môi trường hiện tại
- **Severity**: Low
- **Where**: command execution environment
- **Problem**:
  - API advisory endpoint trả 403 -> chưa có bằng chứng SCA runtime mới nhất.
- **Why it matters in production**:
  - Khoảng trống kiểm soát supply-chain nếu không có scanner thay thế.
- **Recommended fix**:
  - Chạy SCA trong CI qua network được cấp quyền (npm audit/Snyk/OSV).
- **How to verify after fix**:
  - Có báo cáo vulnerability định kỳ và policy fail build theo severity.

## IV. Production Readiness Checklist

| Nhóm | Trạng thái | Ghi chú ngắn |
|---|---|---|
| Code quality | PARTIAL | Có test/lint pass, nhưng còn risk durability và memory DoS |
| Security | PARTIAL | Auth + DB rules tốt, nhưng thiếu hardening headers và proxy/rate-limit hardening |
| Config | PARTIAL | Có PM2 + env usage, nhưng thiếu `.env.example` và readiness env validation sâu |
| Database | PARTIAL | Thiết kế index/detail tốt, nhưng migration/lookup count cần chiến lược reconcile/rollback rõ hơn |
| Performance | PARTIAL | Pagination tốt; còn risk export/import lớn và in-memory limiter |
| Observability | FAIL | Chưa có metrics/tracing/alerts chính thức |
| CI/CD | FAIL | Không tìm thấy pipeline config trong repo |
| Rollback | NOT FOUND | Không có runbook rollback rõ ràng cho app+data migration |
| Documentation | PARTIAL | Có deployment guide nhưng thiếu một số tài liệu vận hành bắt buộc |

## V. Top Priority Fix Plan

### Fix before deploy
1. Thay rate limiter in-memory bằng giải pháp bounded/distributed + cleanup rõ ràng.
2. Tách bulk import sang job queue durable và bảo đảm idempotent resume.
3. Bổ sung readiness endpoint kiểm tra Firebase (timeout ngắn) và dùng trong deploy gate.
4. Thiết lập CI/CD pipeline tối thiểu (lint + test + SCA + build artifact).

### Can deploy but must fix soon
1. Structured logging + metrics + alerting baseline.
2. Hardening proxy/IP handling (`trust proxy`) và security headers đầy đủ.
3. Bổ sung runbook migration ownership + failure handling.

### Nice to improve later
1. Reconcile job cho `ud_key_lookup.count`.
2. Performance test định kỳ cho export/import lớn.
3. Chuẩn hóa tài liệu vận hành (on-call checklist, secret rotation cadence).

## VI. Final Go/No-Go Recommendation

- **Khuyến nghị hiện tại**: **NO-GO cho production ngay lúc này**.
- **Minimum bắt buộc trước khi GO**:
  1. Xử lý Critical memory DoS ở rate limiter.
  2. Có cơ chế bulk job durable khi restart/redeploy.
  3. Có readiness check thực và deploy gate tương ứng.
  4. Có CI/CD pipeline chặn lỗi cơ bản.
- **Điều kiện cho phép deploy**:
  - Tất cả mục trên hoàn thành + chạy lại test/lint/load smoke + xác nhận playbook rollback khả dụng.
