# Template Thực Hiện Task — Agent Execution Guide

> **Dùng file này như một hướng dẫn chuẩn.**  
> Khi bạn muốn thực hiện một task, chỉ cần nói:  
> `"Thực hiện theo task TASK-XX trong project_task.md"`  
> Agent sẽ tự động làm theo đúng quy trình dưới đây.

---

## Quy Trình Thực Hiện (Agent phải tuân thủ 100%)

### Bước 0 — Kiểm tra tiền điều kiện

Trước khi làm bất kỳ điều gì, agent phải:

1. **Đọc `project_task.md`** để lấy thông tin task được yêu cầu
2. **Kiểm tra trạng thái task:** Nếu task đã có trạng thái `[x] HOÀN THÀNH` → báo cáo và dừng lại
3. **Kiểm tra phụ thuộc:** Đọc mục "Phụ thuộc" của task
   - Nếu task phụ thuộc có trạng thái `[ ] CHƯA THỰC HIỆN` → **DỪNG LẠI**, hỏi user:
     > "Task này phụ thuộc vào TASK-XX chưa hoàn thành. Bạn có muốn tôi thực hiện TASK-XX trước, hay bạn đã thực hiện rồi và cần tôi kiểm tra lại trạng thái?"
4. **Đọc `project_memory.md`** để nắm context hiện tại của project

---

### Bước 1 — Thực Hiện Task

- Thực hiện đúng theo mô tả trong `project_task.md`
- Tạo/chỉnh sửa đúng các file được liệt kê trong mục "Output file"
- Với mỗi mục tiêu hoàn thành, kiểm tra xem đã đạt chưa trước khi tiếp tục

---

### Bước 2 — Cập Nhật Trạng Thái Task

Sau khi thực hiện xong, cập nhật `project_task.md`:

```
Thay đổi:
- [ ] CHƯA THỰC HIỆN  →  [x] HOÀN THÀNH — 2026-03-28 10:00
- [ ] <mục tiêu>  →  [x] <mục tiêu>
```

---

### Bước 3 — Ghi `.opushforce.message`

**GHI ĐÈ** (overwrite) toàn bộ nội dung file với PR message của task vừa thực hiện:

```
feat(TASK-XX): <tên task ngắn gọn>

- <bullet point tóm tắt việc đã làm>
- <bullet point tiếp theo>
- Files: <danh sách file đã tạo/sửa>

Task: TASK-XX | Status: COMPLETED | Date: YYYY-MM-DD HH:mm
```

---

### Bước 4 — Cập Nhật `CHANGE_LOGS.md`

**PREPEND** (thêm vào ĐẦU FILE) entry mới:

```markdown
## [TASK-XX] YYYY-MM-DD HH:mm — <Tên task>

### Thay đổi kỹ thuật

- <Mô tả chi tiết về code/config đã thay đổi>
- Files tạo mới: `path/to/file.js`
- Files sửa: `path/to/other.js`

### Lý do

- <Tại sao cần thay đổi này>

---
```

---

### Bước 5 — Cập Nhật `CHANGE_LOGS_USER.md`

**PREPEND** (thêm vào ĐẦU FILE) entry mới, viết theo góc nhìn người dùng (không cần biết code):

```markdown
## YYYY-MM-DD HH:mm — <Tính năng/Cải tiến>

**Đã thêm/Cải thiện:**

- <Mô tả tính năng theo góc nhìn user, không dùng thuật ngữ kỹ thuật>
- <Ví dụ: "Giờ có thể tìm kiếm contact bằng email phụ">

---
```

---

### Bước 6 — Cập Nhật `project_memory.md`

**GHI ĐÈ** (cập nhật) các section liên quan:

```markdown
# Project Memory — Self-hosted Contact Manager

> Cập nhật: YYYY-MM-DD HH:mm | Task hoàn thành gần nhất: TASK-XX

## Tổng quan project

[Mô tả project, mục đích, tech stack]

## Trạng thái hiện tại

- Task đã hoàn thành: TASK-01, TASK-02, ...
- Task tiếp theo cần làm: TASK-XX
- Vấn đề đang mở: [liệt kê nếu có]

## Cấu trúc file quan trọng

[Các file đã tạo và mục đích]

## Quyết định kỹ thuật đã đưa ra

[Các quyết định design đã chốt]

## Cấu hình & Secrets cần thiết

[Các env vars, config cần setup]

## Ghi chú cho agent tiếp theo

[Những điều cần biết để tiếp tục]
```

---

### Bước 7 — Cập Nhật `Readme.md`

Cập nhật các section liên quan đến task vừa thực hiện:

- Thêm hướng dẫn setup nếu có file config mới
- Thêm hướng dẫn chạy nếu có script mới
- Cập nhật bảng tính năng/status

---

### Bước 8 — Tạo File ZIP

Tạo file ZIP toàn bộ source code với tên:

```
<project-name> <yyyyMMdd-HHmm> <nội-dung-cập-nhật>.zip
```

Ví dụ: `contacts-selfhost 20260328-1030 init-firebase-setup.zip`

**Yêu cầu ZIP:**

- Bao gồm TẤT CẢ file trong project (kể cả các file tracking ở trên)
- KHÔNG bao gồm: `node_modules/`, `dist/`, `.env`, service account keys
- Đường dẫn trong ZIP bắt đầu từ root của project (không có thư mục cha)
- Giải nén + chép đè vào thư mục hiện tại là chạy được

---

## Ví Dụ Lệnh Yêu Cầu

```
# Yêu cầu thực hiện 1 task cụ thể:
"Thực hiện TASK-01 trong project_task.md"

# Yêu cầu xem trạng thái:
"Cho tôi biết trạng thái hiện tại của tất cả tasks"

# Yêu cầu thực hiện task tiếp theo:
"Thực hiện task tiếp theo chưa hoàn thành"

# Yêu cầu kiểm tra trước khi làm:
"Kiểm tra TASK-05 đã có thể thực hiện chưa (dependencies đã xong chưa)"
```

---

## Quy Tắc Bắt Buộc

| Quy tắc                                | Mô tả                                         |
| -------------------------------------- | --------------------------------------------- |
| ✅ Luôn đọc `project_task.md` trước    | Không được làm mà không đọc task spec         |
| ✅ Kiểm tra dependency trước khi làm   | Hỏi user nếu dep chưa xong                    |
| ✅ Cập nhật TẤT CẢ 6 file tracking     | Không được bỏ sót file nào                    |
| ✅ PREPEND cho CHANGE_LOGS             | Không append cuối file                        |
| ✅ OVERWRITE cho `.opushforce.message` | Không append                                  |
| ✅ Tạo ZIP cuối mỗi task               | Đường dẫn trong ZIP là relative từ root       |
| ❌ Không làm nhiều task cùng lúc       | Làm tuần tự, xong task này mới sang task khác |
| ❌ Không bỏ qua bước cập nhật file     | Dù task đơn giản cũng phải cập nhật           |
