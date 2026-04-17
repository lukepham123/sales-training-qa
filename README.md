# Cong cu Q&A dao tao nhan vien ban hang - Nganh me & be

He thong Q&A thong minh giup nhan vien ban hang tra cuu cach xu ly tinh huong khach thuong gap (phan doi gia, so sanh san pham, an toan cho be...).

## Nguyen ly tiet kiem token

1. Nhan vien go cau hoi → tim trong kho noi bo (bo A da duyet + bo B phat sinh).
2. Co ket qua lien quan → tra ve ngay (KHONG ton token Claude).
3. Khong co → bam "Yeu cau AI tra loi" → goi Claude API (TON TOKEN) → luu cap Q&A vao bo B cho duyet.
4. Admin duyet/sua/xoa → kho A lon dan → ti le goi AI giam dan.

## Cai dat (local)

```bash
# 1. Cai thu vien
npm install

# 2. Copy file env va dan ANTHROPIC_API_KEY vao
cp .env.example .env

# 3. Nap bo cau hoi A ban dau (46 tinh huong me & be)
npm run seed

# 4. Chay server
npm start
```

Mo trinh duyet: **http://localhost:3000**

- Trang nhan vien: `/`
- Trang admin: `/admin` (mat khau mac dinh `admin123`, doi trong `.env`)

## Trien khai len Hostinger Web App

1. Push code len GitHub repo
2. Vao Hostinger Panel > Web Apps > Add New > Connect GitHub
3. Cau hinh:
   - Build command: `npm install && npm run seed`
   - Start command: `npm start`
   - Environment variables: ANTHROPIC_API_KEY, ADMIN_PASSWORD, PORT
4. Deploy > co link HTTPS dang https://your-app.hostinger.app

Xem huong dan chi tiet: DEPLOY_HOSTINGER.md

## Yeu cau

- **Node.js >= 18** (dung `better-sqlite3`).
- API key Claude: lay tai https://console.anthropic.com/

## Cau truc du an

```
.
├── src/
│   ├── server.js       # HTTP server (dung node:http, tu route)
│   ├── db.js           # SQLite (dung better-sqlite3)
│   ├── search.js       # Hybrid search (keyword + semantic gia lap)
│   ├── claude.js       # Goi Claude API bang fetch
│   ├── seed.js         # Script nap bo A
│   └── env.js          # Loader .env don gian
├── data/
│   ├── initial_bo_a.json  # 46 cau hoi mau nganh me & be
│   └── qa.db              # SQLite (tu dong sinh)
├── public/
│   ├── index.html      # Trang nhan vien
│   ├── admin.html      # Trang admin
│   └── style.css       # Style chung
├── package.json
├── .env.example
└── README.md
```

## API endpoints

| Method | Path | Mo ta | Ton token? |
|-------|------|------|-----------|
| POST | `/api/search` | Tim cau hoi trong A+B | Khong |
| GET | `/api/qa/:id` | Xem chi tiet 1 Q&A | Khong |
| POST | `/api/ask-ai` | Goi Claude khi khong tim thay | Co |
| POST | `/api/admin/login` | Dang nhap admin | Khong |
| GET | `/api/admin/stats` | Thong ke | Khong |
| GET | `/api/admin/pending` | Danh sach cho duyet | Khong |
| GET | `/api/admin/approved` | Danh sach da duyet | Khong |
| POST | `/api/admin/approve/:id` | Duyet cau hoi | Khong |
| PUT | `/api/admin/edit/:id` | Sua cau hoi/tra loi | Khong |
| DELETE | `/api/admin/reject/:id` | Xoa cau cho duyet | Khong |

Cac API admin can header `X-Admin-Password`.

## Luu y chi phi

- Mac dinh dung `claude-haiku-4-5-20251001` (re ~1/10 so voi Sonnet). Doi trong `.env` neu muon.
- Tat ca tra cuu/hien thi deu free - chi nut **"Yeu cau AI"** moi goi Claude.
- Moi lan goi ghi lai trong bang `ai_calls` de theo doi chi phi.

## Lo trinh nang cap (theo tai lieu kien truc)

- Giai doan 2: Tich hop embedding model that (OpenAI / Voyage) + vector DB → chuyen sang hybrid search day du.
- Giai doan 3: Dashboard phan tich chi phi token, ti le hit bo A, cau hoi duoc hoi nhieu nhat.
- Giai doan 4: Tich hop Zalo / Messenger de nhan vien hoi truc tiep trong chat.

## Chuyen tu zero-dep sang phien ban production

Neu trien khai that:
- Thay `node:sqlite` bang PostgreSQL + pgvector (hoac Qdrant/Chroma).
- Thay `node:http` + routing tay bang Express/Fastify + reverse proxy (nginx/Caddy).
- Them xac thuc admin nghiem (JWT/session, khong chi password trong header).
- Them embedding that (OpenAI text-embedding-3-small) thay cho semantic score gia lap.
