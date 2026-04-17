# Sales Training Q&A - Project Context v2.2.0

## Muc dich
Cong cu dao tao nhan vien ban hang nganh me & be (Hello Con - hellocon.vn). Nhan vien hoi cau hoi -> he thong tra ve cau tra loi tu Bo A (admin nhap san) hoac goi Claude AI de tao cau tra loi moi (Bo B, cho admin duyet).

## Cong nghe
- **Node.js** (>=18), zero-framework, chi dung `node:http`
- **better-sqlite3** - SQLite database tai `data/qa.db`
- **xlsx** - import excel
- **Claude API** (Anthropic) - tao cau tra loi AI
- **Telegram Bot** - gui thong bao khi nhan vien hoi AI
- **CommonJS** (type: "commonjs")

## Cau truc thu muc

```
sales-training-qa/
  package.json          # v2.2.0
  .env                  # ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, etc.
  data/
    qa.db               # SQLite database (WAL mode)
    initial_bo_a.json   # Du lieu seed Bo A
    qa_data.json        # Du lieu qa backup
    knowledge.md        # Kien thuc bo sung
  src/
    server.js           # HTTP server, routing, API endpoints chinh
    db.js               # SQLite schema, CRUD, auth functions
    admin-routes.js     # Admin API routes (import, settings, employees, users, chat...)
    search.js           # Hybrid search: keyword + Jaccard semantic + match count + word order
    claude.js           # Goi Claude API, generateAnswer()
    settings.js         # Quan ly API key, model, prompts
    env.js              # Load .env
    seed.js             # Seed du lieu ban dau
    telegram.js         # Gui thong bao Telegram
    otp.js              # OTP 2FA
    excel-parser.js     # Parse file Excel import
  public/
    index.html          # Trang nhan vien (hoi/tra loi, hoi AI)
    admin.html          # Trang admin (quan ly Q&A, users, employees, settings...)
    login.html          # Trang dang nhap
```

## Database Schema (SQLite)

### Bang `qa` - Cau hoi & tra loi
```sql
CREATE TABLE qa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('A','B')),     -- A: admin nhap, B: AI tao
  status TEXT NOT NULL CHECK(status IN ('approved','pending','rejected')),
  keywords TEXT NOT NULL,    -- JSON array cac tu khoa
  topic TEXT,                -- Chu de
  asked_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Bang `employees` - Danh sach ten nhan vien (RIENG BIET voi users)
```sql
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```
- Day la danh sach ho ten nhan vien de kiem soat ai duoc hoi AI
- KHONG lien ket voi bang `users` (tai khoan dang nhap)
- Khi nhan vien hoi AI, phai nhap dung ho ten co trong danh sach nay
- So sanh case-insensitive
- Neu danh sach rong -> ai cung hoi duoc

### Bang `users` - Tai khoan dang nhap
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','employee')),
  display_name TEXT,
  otp_secret TEXT,
  otp_enabled INTEGER DEFAULT 0,
  session_token TEXT,
  session_expires TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```
- Default admin: admin / admin123
- Password: SHA256 + random salt, luu dang `salt:hash`
- Session: 30 phut cho admin, 1 nam cho employee

### Bang `ai_calls` - Log goi AI
```sql
CREATE TABLE ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  qa_id INTEGER,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (qa_id) REFERENCES qa(id)
);
```

### Bang `employee_questions` - Lich su cau hoi cua nhan vien
```sql
CREATE TABLE employee_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Bang `import_history` - Lich su import Excel
### Bang `telegram_recipients` - Danh sach nhan thong bao Telegram

## API Endpoints

### Public (khong can auth)
- `POST /api/search` - Tim kiem Q&A (hybrid search, KHONG ton token AI)
- `GET /api/qa/:id` - Chi tiet 1 cau hoi
- `GET /api/topics` - Danh sach chu de
- `POST /api/ask-ai` - Hoi AI (can employeeName, validate voi danh sach employees)
- `PUT /api/qa/:id/topic` - NV cap nhat topic cho cau hoi pending
- `GET /api/employee-names` - Lay danh sach ten NV (cho client validate)

### Admin (can auth: x-admin-password header hoac Bearer token)
- `POST /api/admin/login` - Dang nhap
- `GET /api/admin/stats` - Thong ke
- `GET /api/admin/pending` - Danh sach cho duyet
- `GET /api/admin/approved` - Danh sach da duyet
- `POST /api/admin/approve/:id` - Duyet cau hoi
- `PUT /api/admin/edit/:id` - Sua cau hoi
- `DELETE /api/admin/reject/:id` - Xoa cau hoi
- Employee CRUD: `GET/POST /api/admin/employees`, `PUT/DELETE /api/admin/employees/:id`
- User CRUD: `GET/POST /api/admin/users`, `DELETE /api/admin/users/:id`, `POST /api/admin/change-password`
- Import: `POST /api/admin/import-json`, `POST /api/admin/import-excel`
- Settings: `GET/POST /api/admin/settings`, `GET/POST /api/admin/prompts`, `GET/POST /api/admin/api-keys`
- Chat: `POST /api/admin/chat`
- History: `GET /api/admin/employee-questions`, `GET /api/admin/import-history`
- Telegram: `GET/POST/DELETE /api/admin/telegram-recipients`, `POST /api/admin/telegram-test`
- Auth verify: `POST /api/auth/verify`, `POST /api/auth/login`, `POST /api/auth/change-password`
- OTP: `POST /api/auth/otp/setup`, `POST /api/auth/otp/verify`, `POST /api/auth/otp/disable`

## Tinh nang chinh

1. **Tim kiem hybrid** - Ket hop keyword matching + Jaccard semantic + match count + word order
2. **Hoi AI (Claude)** - Goi Claude API voi context tu Bo A, tao cau tra loi, luu vao Bo B cho duyet
3. **Quan ly Q&A** - Admin duyet/sua/xoa cau hoi Bo B, quan ly Bo A
4. **Danh sach nhan vien** - Admin them/sua/xoa ten + SĐT nhan vien. Chi nguoi co ten trong list moi hoi AI duoc
5. **Tai khoan dang nhap** - Admin va employee accounts, OTP 2FA
6. **Import Excel/JSON** - Import cau hoi hang loat
7. **Thong bao Telegram** - Gui thong bao khi NV hoi AI
8. **Quan ly API key** - Nhieu key, chon active key
9. **Extra prompts** - Admin them cac prompt bo sung cho AI
10. **Lich su** - Xem lich su cau hoi NV, lich su import

## Luu y ky thuat quan trong

- **Migration pattern**: `try { db.exec("ALTER TABLE ...") } catch (e) { /* already exists */ }`
- **Search KHONG ton token** - chi chay local, khong goi Claude API
- **Hoi AI TON token** - goi Claude API qua `/api/ask-ai`
- **employees != users** - 2 bang rieng biet, khong lien ket
- **toggleAnswer fallback** - Cache truoc, neu khong co thi goi API `/api/qa/:id`
- **Session admin** - 30 phut timeout, employee 1 nam
- **Luon ghi version** khi thay doi code (hien tai v2.2.0)

## Lich su phien ban

- **v2.0.0** - Base version voi Q&A, search, AI, admin
- **v2.1.0** - Fix bug "khong co cau tra loi" (toggleAnswer fallback), them danh sach nhan vien rieng (bang employees), validate ten khi hoi AI, canh bao ten sai
- **v2.2.0** - Them cot so dien thoai (phone) cho danh sach nhan vien
