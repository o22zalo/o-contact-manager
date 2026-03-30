# Hướng dẫn triển khai đồng thời Frontend + Backend trên cùng 1 máy

## 1) Chuẩn bị máy chủ

Yêu cầu tối thiểu đề xuất:

- CPU 2 vCPU, RAM 4GB (demo);
- Docker Engine + Docker Compose plugin;
- Domain đã quản lý trên Cloudflare;
- Firebase service account JSON hợp lệ.

Cài Docker (Ubuntu):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker version
docker compose version
```

## 2) Chuẩn bị source + biến môi trường

```bash
git clone <repo-url>
cd o-contact-manager
cp .env.docker.example .env.docker
mkdir -p secrets logs data
```

Copy service account:

```bash
cp /path/to/serviceAccountKey.json ./secrets/firebase_service_account.json
chmod 600 ./secrets/firebase_service_account.json
```

Sửa `.env.docker`:

- Domain: `APP_DOMAIN`, `PORTAINER_DOMAIN`, `LOGS_DOMAIN`, `FILES_DOMAIN`
- Cloudflare tunnel token: `CLOUDFLARE_TUNNEL_TOKEN`
- Tailscale auth key: `TAILSCALE_AUTHKEY`
- Firebase project info
- Basic auth hash cho Caddy

## 3) Khởi chạy toàn bộ stack Docker

```bash
docker compose build
docker compose up -d
```

Kiểm tra:

```bash
docker compose ps
docker compose logs -f caddy
docker compose logs -f backend
curl -I http://localhost
curl http://localhost/health
```

## 4) Khởi tạo Filebrowser/Portainer lần đầu

- Portainer: vào `https://portainer.your-domain` và tạo admin account.
- Filebrowser: mặc định đọc cấu hình từ `docker/filebrowser/settings.json`.
  - Nếu cần user/password mới:

```bash
docker compose exec filebrowser filebrowser users add admin NewStrongPass --perm.admin
```

## 5) Kiểm tra tương thích frontend/backend sau deploy

1. Mở `https://app.your-domain`
2. Vào Settings nhập API key.
3. Test các chức năng:
   - list contacts
   - tạo/sửa/xóa contact
   - stats
   - import/export

Nếu frontend và backend cùng domain, frontend gọi `/api/*` qua Caddy nên tránh CORS phức tạp.

## 6) Triển khai demo qua GitHub Actions

File mẫu: `.github/workflows/demo-stack.yml`

Luồng:

1. Push nhánh `main`.
2. Workflow SSH vào server demo.
3. Pull source + build + `docker compose up -d`.
4. Chạy smoke checks (`/health`, container status).

Secrets gợi ý:

- `DEMO_HOST`, `DEMO_USER`, `DEMO_SSH_KEY`, `DEMO_PATH`

## 7) Triển khai demo qua Azure Pipelines

File mẫu: `azure-pipelines.yml`

Luồng tương tự GitHub Actions:

- Trigger khi commit `main`
- SSH task chạy script deploy Docker Compose
- In status containers + health check

Biến/secret gợi ý:

- `demoHost`, `demoUser`, `demoPath`, `sshServiceConnection`

## 8) Vận hành hằng ngày

- Xem logs realtime: `https://logs.your-domain` (Dozzle)
- Quản lý stack/container: `https://portainer.your-domain`
- Xem file logs/data: `https://files.your-domain`

## 9) Checklist go-live

- [ ] Cloudflare DNS + Tunnel ingress đúng subdomain
- [ ] Tailscale online và ping được host trong tailnet
- [ ] `docker compose ps` không có service crash-loop
- [ ] `GET /health` trả `status=ok`
- [ ] Login API key từ frontend thành công
- [ ] Backup định kỳ thư mục `data`, `logs`, và secrets

## 10) Lệnh rollback nhanh

```bash
git checkout <tag-or-commit-stable>
docker compose build --no-cache
docker compose up -d
```

Nếu cần rollback dữ liệu, restore từ snapshot/backup trước deploy.
