# Hướng dẫn đưa lên GitHub và Hostinger

## Phần 1: Đưa lên GitHub

### Bước 1: Tạo repository trên GitHub

1. Vào https://github.com và đăng nhập (hoặc đăng ký nếu chưa có tài khoản)
2. Bấm nút **"+"** góc phải trên → **"New repository"**
3. Điền thông tin:
   - Repository name: `sales-training-qa` (hoặc tên bạn muốn)
   - Chọn **Private** (quan trọng vì code chứa logic kinh doanh)
   - KHÔNG tick "Initialize this repository" (vì mình đã có code)
4. Bấm **"Create repository"**
5. Lưu lại URL repo, ví dụ: `https://github.com/YOUR_USERNAME/sales-training-qa.git`

### Bước 2: Cài đặt Git trên máy (nếu chưa có)

Tải Git tại: https://git-scm.com/download/win

Sau khi cài, mở **Command Prompt** hoặc **PowerShell** và chạy:

```
git config --global user.name "Tên của bạn"
git config --global user.email "khongdangnhap@hellocon.vn"
```

### Bước 3: Push code lên GitHub

Mở Command Prompt, cd vào thư mục dự án:

```
cd "C:\Users\NGOCTANG8\Documents\Claude\Projects\Tạo một AI về đào tạo nhân viên cách trả lời khách khi bán hàng"
```

Chạy lần lượt:

```
git init
git add .
git commit -m "v2.3.0 - Sales training QA tool"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sales-training-qa.git
git push -u origin main
```

(Thay `YOUR_USERNAME` bằng username GitHub thực của bạn)

Nếu GitHub yêu cầu đăng nhập, nhập username và **Personal Access Token** (không phải mật khẩu). Tạo token tại: https://github.com/settings/tokens → Generate new token (classic) → tick repo → Generate.

---

## Phần 2: Deploy lên Hostinger VPS

### Bước 1: Mua và truy cập VPS

1. Vào https://www.hostinger.vn → chọn gói **VPS** (gói rẻ nhất đủ dùng)
2. Chọn hệ điều hành: **Ubuntu 22.04**
3. Sau khi mua, vào **hPanel** → **VPS** → ghi lại **IP address** và **root password**

### Bước 2: Kết nối vào VPS

Trên Windows, mở PowerShell:

```
ssh root@YOUR_VPS_IP
```

(Thay `YOUR_VPS_IP` bằng IP thực của VPS)

Hoặc dùng **PuTTY** (tải tại https://putty.org)

### Bước 3: Cài đặt Node.js trên VPS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs git build-essential
node -v   # kiểm tra, phải >= 18
npm -v
```

### Bước 4: Clone code từ GitHub

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/sales-training-qa.git app
cd app
```

### Bước 5: Cài dependencies

```bash
npm install
```

### Bước 6: Tạo file .env

```bash
nano .env
```

Dán nội dung sau (chỉnh theo thông tin thực):

```
ANTHROPIC_API_KEY=sk-ant-YOUR_REAL_KEY_HERE
CLAUDE_MODEL=claude-haiku-4-5-20251001
PORT=3000
ADMIN_PASSWORD=mat_khau_manh_cua_ban
```

Bấm `Ctrl+O` → Enter → `Ctrl+X` để lưu và thoát.

### Bước 7: Chạy thử

```bash
node src/server.js
```

Nếu thấy `[server] Running on http://localhost:3000` là OK. Bấm `Ctrl+C` để dừng.

### Bước 8: Cài PM2 (giữ app chạy liên tục)

```bash
npm install -g pm2
pm2 start src/server.js --name "qa-app"
pm2 startup    # tự khởi động khi VPS restart
pm2 save
```

Kiểm tra: `pm2 status` → phải thấy app đang "online".

### Bước 9: Cài Nginx (reverse proxy + domain)

```bash
apt install -y nginx
```

Tạo file config:

```bash
nano /etc/nginx/sites-available/qa-app
```

Dán nội dung:

```nginx
server {
    listen 80;
    server_name yourdomain.com;   # thay bang domain cua ban

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 20M;
    }
}
```

Kích hoạt:

```bash
ln -s /etc/nginx/sites-available/qa-app /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t          # kiểm tra config
systemctl restart nginx
```

### Bước 10: Cài SSL (HTTPS miễn phí)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

Làm theo hướng dẫn, certbot sẽ tự cấu hình HTTPS.

### Bước 11: Trỏ domain

Vào nơi quản lý DNS của domain (Hostinger, Cloudflare, etc.):
- Tạo bản ghi **A record**: `@` → IP VPS của bạn
- Tạo bản ghi **A record**: `www` → IP VPS của bạn

Đợi 5-30 phút để DNS cập nhật.

---

## Cập nhật code sau này

Khi thay đổi code trên máy local:

```
cd "C:\Users\NGOCTANG8\Documents\Claude\Projects\Tạo một AI về đào tạo nhân viên cách trả lời khách khi bán hàng"
git add .
git commit -m "Mo ta thay doi"
git push
```

Trên VPS:

```bash
cd /opt/app
git pull
pm2 restart qa-app
```

---

## Lệnh hữu ích trên VPS

| Lệnh | Mô tả |
|-------|-------|
| `pm2 status` | Xem trạng thái app |
| `pm2 logs qa-app` | Xem log realtime |
| `pm2 restart qa-app` | Restart app |
| `pm2 stop qa-app` | Dừng app |
| `systemctl status nginx` | Xem trạng thái Nginx |
| `certbot renew --dry-run` | Test gia hạn SSL |

---

## Lưu ý bảo mật

- Đổi mật khẩu admin mặc định ngay sau deploy
- Bật OTP cho tài khoản admin
- Không commit file `.env` lên GitHub (đã có trong .gitignore)
- Thường xuyên `apt update && apt upgrade` trên VPS
- File database nằm ở `/opt/app/data/qa.db` — nên backup định kỳ
