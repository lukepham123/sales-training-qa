// Seed data: Import real Q&A from qa_data.json (generated from Excel files)
// Run: npm run seed
// v2.0.1: Preserves existing data (users, settings, employee_questions, ai_calls, import_history, telegram_recipients)
//         Only refreshes bank A Q&A from qa_data.json and knowledge prompts.
//         Use --reset flag to start completely fresh.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'qa.db');
const DB_DIR = path.dirname(DB_PATH);
const isReset = process.argv.includes('--reset');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

if (isReset && fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('[seed] --reset: Deleted old qa.db');
}

const db = new Database(DB_PATH);
try { db.pragma('journal_mode = WAL'); } catch (e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS qa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source TEXT DEFAULT 'A',
    status TEXT DEFAULT 'approved',
    keywords TEXT DEFAULT '[]',
    topic TEXT,
    asked_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ai_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT,
    qa_id INTEGER,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    topic TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS employee_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
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
  CREATE TABLE IF NOT EXISTS import_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    imported_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS telegram_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    label TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed default admin if no users
const crypto = require('crypto');
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update('admin123' + salt).digest('hex');
  db.prepare('INSERT INTO users (username, password_hash, role, display_name) VALUES (?,?,?,?)').run('admin', salt + ':' + hash, 'admin', 'Admin');
  console.log('[seed] Created default admin user: admin / admin123');
} else {
  console.log('[seed] Users: ' + userCount + ' (preserved)');
}

function tokenize(text) {
  return [...new Set(
    text.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s\u00C0-\u024F\u1E00-\u1EFF]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
  )];
}

const dataPath = path.join(__dirname, '..', 'data', 'qa_data.json');
if (!fs.existsSync(dataPath)) {
  console.error('[seed] ERROR: data/qa_data.json not found!');
  process.exit(1);
}

const qaData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
console.log('[seed] Loading ' + qaData.length + ' Q&A pairs from qa_data.json...');

const existingQs = new Set(
  db.prepare("SELECT question FROM qa WHERE source='A' AND status='approved'").all()
    .map(function(r) { return r.question.toLowerCase().trim(); })
);
console.log('[seed] Existing bank A: ' + existingQs.size);

const insert = db.prepare(
  "INSERT INTO qa (question, answer, source, status, keywords, topic, asked_count) VALUES (?, ?, 'A', 'approved', ?, ?, 0)"
);

const insertMany = db.transaction(function(items) {
  var added = 0, skipped = 0;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var qLower = item.question.toLowerCase().trim();
    if (existingQs.has(qLower)) { skipped++; continue; }
    var kw = JSON.stringify(tokenize(item.question + ' ' + item.answer));
    insert.run(item.question, item.answer, kw, item.topic || null);
    existingQs.add(qLower);
    added++;
  }
  return { added: added, skipped: skipped };
});

var result = insertMany(qaData);
console.log('[seed] Bank A: +' + result.added + ' new, ' + result.skipped + ' skipped');

// Print preserved data counts
var counts = {
  pending: db.prepare("SELECT COUNT(*) AS c FROM qa WHERE status='pending'").get().c,
  bApproved: db.prepare("SELECT COUNT(*) AS c FROM qa WHERE source='B' AND status='approved'").get().c,
  aiCalls: db.prepare("SELECT COUNT(*) AS c FROM ai_calls").get().c,
  empQs: db.prepare("SELECT COUNT(*) AS c FROM employee_questions").get().c,
  imports: db.prepare("SELECT COUNT(*) AS c FROM import_history").get().c,
  tg: db.prepare("SELECT COUNT(*) AS c FROM telegram_recipients").get().c,
};
console.log('[seed] Preserved: pending=' + counts.pending + ', B-approved=' + counts.bApproved +
  ', AI-calls=' + counts.aiCalls + ', emp-questions=' + counts.empQs +
  ', imports=' + counts.imports + ', tg-recipients=' + counts.tg);

// Knowledge prompts
var promptCount = db.prepare('SELECT COUNT(*) AS c FROM prompts').get().c;
var knowledgePath = path.join(__dirname, '..', 'data', 'knowledge.md');
if (fs.existsSync(knowledgePath) && (promptCount === 0 || isReset)) {
  if (promptCount > 0) {
    db.exec("DELETE FROM prompts WHERE topic='Tai lieu dao tao'");
  }
  var knowledge = fs.readFileSync(knowledgePath, 'utf8');
  var chunks = [];
  var paragraphs = knowledge.split(/\n\n+/);
  var current = '';
  for (var p = 0; p < paragraphs.length; p++) {
    var para = paragraphs[p];
    if (current.length + para.length > 2000 && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += '\n\n' + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  var insertPrompt = db.prepare('INSERT INTO prompts (content, topic) VALUES (?, ?)');
  for (var c = 0; c < chunks.length; c++) {
    insertPrompt.run(chunks[c], 'Tai lieu dao tao');
  }
  console.log('[seed] Inserted ' + chunks.length + ' knowledge chunks');
} else if (promptCount > 0) {
  console.log('[seed] Prompts exist (' + promptCount + '), skipping');
}

db.close();
console.log('[seed] Done! DB at', DB_PATH);
