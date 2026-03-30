# Kiến trúc tổng quan triển khai (Frontend + Backend + Ops)

```text
Internet
  │
  ▼
Cloudflare Edge
  │  (Cloudflare Tunnel — không cần mở port)
  ▼
cloudflared (container)
  │
  ▼
Caddy (reverse proxy + SSL tự động)
  ├── app.domain.com       → Frontend (Nginx static) + /api → Backend Node.js [basic auth]
  ├── portainer.domain.com → Portainer                        [auth riêng]
  ├── logs.domain.com      → Dozzle                           [basic auth]
  └── files.domain.com     → Filebrowser                      [basic auth]

Team nội bộ
  │
  ▼
Tailscale VPN → Caddy (qua IP tailscale của máy chủ)
```

## Thành phần chính

- **backend**: Node.js API (`src/index.js`), kết nối Firebase.
- **frontend**: Vite build thành static, phục vụ qua Nginx.
- **caddy**: reverse proxy trung tâm, route theo domain/subdomain.
- **cloudflared**: tunnel từ Cloudflare Edge tới Caddy nội bộ.
- **tailscale**: tạo private mesh để team truy cập nội bộ an toàn.
- **dozzle**: xem log realtime container nhẹ.
- **portainer**: quản lý Docker stack tổng thể.
- **filebrowser**: xem/chỉnh file trong thư mục data/logs.

## Luồng truy cập

1. Người dùng public vào `app.domain.com` qua Cloudflare.
2. Cloudflare gửi traffic vào tunnel `cloudflared`.
3. `cloudflared` forward tới `caddy`.
4. `caddy` route:
   - `/api` → backend Node.js
   - còn lại → frontend static
5. Team nội bộ có thể vào cùng endpoint qua IP Tailscale.

## Ưu điểm mô hình

- Không cần mở inbound port public trực tiếp trên VPS.
- Một compose stack cho cả app và tooling vận hành.
- Dễ demo trên 1 máy, dễ chuyển sang staging/production.
