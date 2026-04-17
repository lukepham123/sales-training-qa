# Huong dan deploy len Hostinger Web App (goi Business)

## Buoc 1: Tao GitHub repo

1. Vao https://github.com/new
2. Dat ten repo (vi du: `sales-training-qa`)
3. Chon **Private** (vi co API key logic)
4. **KHONG** tick "Add README" (vi da co san)
5. Bam Create repository

## Buoc 2: Push code len GitHub

Mo PowerShell trong thu muc du an:

```powershell
cd "C:\Users\NGOCTANG8\Documents\Claude\Projects\Tạo một AI về đào tạo nhân viên cách trả lời khách khi bán hàng"

git init
git add .
git commit -m "Initial commit - Sales Training QA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sales-training-qa.git
git push -u origin main
```

Thay `YOUR_USERNAME` bang GitHub username cua ban.

## Buoc 3: Ket noi Hostinger

1. Dang nhap https://hpanel.hostinger.com/
2. Vao **Web Apps** (hoac Websites > chon domain)
3. Bam **Add New Web App**
4. Chon **Node.js**
5. Ket noi voi GitHub:
   - Chon repo `sales-training-qa`
   - Branch: `main`

## Buoc 4: Cau hinh Build & Start

Trong trang cau hinh app:

- **Build command**: `npm install && npm run seed`
- **Start command**: `npm start`
- **Node version**: Chon 18 hoac 20 (khong bat buoc 22 nua)

## Buoc 5: Thiet lap Environment Variables

Vao tab **Environment Variables** (hoac Settings > Env vars), them:

| Key | Value | Ghi chu |
|-----|-------|---------|
| ANTHROPIC_API_KEY | sk-ant-api03-... | API key Claude cua ban |
| ADMIN_PASSWORD | matkhau_admin_cua_ban | Doi khac admin123 |
| PORT | 3000 | Hoac de Hostinger tu gan |
| NODE_ENV | production | De Node chay che do production |

**QUAN TRONG**: Doi ADMIN_PASSWORD thanh mat khau manh, vi app se cong khai tren internet.

## Buoc 6: Deploy

1. Bam **Deploy** hoac **Build & Deploy**
2. Doi 2-3 phut de Hostinger:
   - Cai `npm install` (cai `better-sqlite3`)
   - Chay `npm run seed` (nap 46 cau hoi)
   - Khoi dong `npm start`
3. Khi thay status **Running** → app da len

## Buoc 7: Truy cap app

Hostinger se cap cho ban domain dang:
- `https://your-app.hostinger.app` (subdomain mien phi)
- Hoac gan domain rieng cua ban (vi du `training.yourshop.vn`)

Thu:
- https://your-app.hostinger.app/ → Trang nhan vien
- https://your-app.hostinger.app/admin → Trang admin

## Luu y ve SQLite tren Hostinger

SQLite ghi file `data/qa.db` trong thu muc app. Tren Hostinger Business:
- File DB duoc giu lai giua cac lan restart (persistent storage).
- Khi **deploy lai tu GitHub** (push code moi), Hostinger rebuild lai app.
  `npm run seed` co logic: neu DB da co du lieu thi BO QUA (khong ghi de).
  Nen du lieu cu van duoc giu.

Tuy nhien, neu ban chay `npm run reset` (trong Build command) thi se XOA
sach DB va nap lai tu file JSON. Chi lam khi can.

## Cap nhat code

Moi khi ban push code moi len GitHub:

```powershell
git add .
git commit -m "Mo ta thay doi"
git push
```

Hostinger se tu dong pull + rebuild + restart app (CI/CD tu dong).

## Backup du lieu

De backup DB:
1. Vao Hostinger File Manager
2. Tim file `data/qa.db`
3. Download ve may

Hoac dung Hostinger backup tu dong (goi Business co chuc nang nay).

## Troubleshooting

| Van de | Cach xu ly |
|--------|-----------|
| Build failed | Check log, thuong do `npm install` loi. Thu deploy lai. |
| 502 Bad Gateway | App chua start xong. Doi 1 phut roi refresh. |
| 401 khi goi AI | ANTHROPIC_API_KEY sai. Vao env vars kiem tra. |
| DB mat du lieu | Check Build command khong co `--reset`. |
| Khong vao duoc /admin | Kiem tra ADMIN_PASSWORD trong env vars. |
