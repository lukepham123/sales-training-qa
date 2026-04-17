// Database layer - better-sqlite3
require('./env').loadEnv();
var path = require('path');
var fs = require('fs');
var Database = require('better-sqlite3');
var crypto = require('crypto');

var DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'qa.db');
var DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

var db = new Database(DB_PATH);
try { db.pragma('journal_mode = WAL'); } catch (e) {}

// Create tables
db.exec([
  "CREATE TABLE IF NOT EXISTS qa (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, source TEXT DEFAULT 'A', status TEXT DEFAULT 'approved', keywords TEXT DEFAULT '[]', topic TEXT, asked_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS ai_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT, qa_id INTEGER, model TEXT, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS employee_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_name TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, model TEXT, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','employee')), display_name TEXT, otp_secret TEXT, otp_enabled INTEGER DEFAULT 0, session_token TEXT, session_expires TEXT, created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS import_history (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, imported_count INTEGER DEFAULT 0, skipped_count INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS telegram_recipients (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, label TEXT, enabled INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL, phone TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))",
  "CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, topic TEXT, prompt_id INTEGER, created_at TEXT DEFAULT (datetime('now')))"
].join(';'));

// Ensure employees table has phone column
try { db.exec("ALTER TABLE employees ADD COLUMN phone TEXT DEFAULT ''"); } catch(e) {}

// ---------- QA ----------
function listApproved() {
  return db.prepare("SELECT * FROM qa WHERE status='approved' ORDER BY id DESC").all();
}
function listApprovedBySource(source) {
  return db.prepare("SELECT * FROM qa WHERE status='approved' AND source=? ORDER BY id DESC").all(source);
}
function listPending() {
  return db.prepare("SELECT * FROM qa WHERE status='pending' ORDER BY id DESC").all();
}
function listAllActive() {
  return db.prepare("SELECT * FROM qa WHERE status IN ('approved','pending') ORDER BY id DESC").all();
}
function getById(id) {
  return db.prepare("SELECT * FROM qa WHERE id=?").get(id);
}
function insertQa(obj) {
  var kw = obj.keywords;
  if (Array.isArray(kw)) kw = JSON.stringify(kw);
  var info = db.prepare("INSERT INTO qa (question, answer, source, status, keywords, topic) VALUES (?,?,?,?,?,?)").run(
    obj.question, obj.answer, obj.source || 'A', obj.status || 'approved', kw || '[]', obj.topic || null
  );
  return db.prepare("SELECT * FROM qa WHERE id=?").get(info.lastInsertRowid);
}
function updateQa(id, obj) {
  var kw = obj.keywords;
  if (Array.isArray(kw)) kw = JSON.stringify(kw);
  db.prepare("UPDATE qa SET question=?, answer=?, keywords=?, topic=?, updated_at=datetime('now') WHERE id=?").run(
    obj.question, obj.answer, kw || '[]', obj.topic || null, id
  );
}
function approveQaToSource(id, source) {
  db.prepare("UPDATE qa SET status='approved', source=?, updated_at=datetime('now') WHERE id=?").run(source, id);
  return db.prepare("SELECT * FROM qa WHERE id=?").get(id);
}
function incrementAskedCount(id) {
  db.prepare("UPDATE qa SET asked_count = asked_count + 1 WHERE id=?").run(id);
}
function deleteApprovedBySource(source) {
  return db.prepare("DELETE FROM qa WHERE source=? AND status='approved'").run(source);
}
function deleteQa(id) {
  db.prepare("DELETE FROM qa WHERE id=?").run(id);
}
function listTopics() {
  return db.prepare("SELECT DISTINCT topic FROM qa WHERE topic IS NOT NULL AND topic != '' ORDER BY topic").all().map(function(r) { return r.topic; });
}

// ---------- AI Calls ----------
function logAiCall(obj) {
  db.prepare("INSERT INTO ai_calls (query, qa_id, model, input_tokens, output_tokens) VALUES (?,?,?,?,?)").run(
    obj.query, obj.qaId || null, obj.model || null, obj.inputTokens || 0, obj.outputTokens || 0
  );
}
function getStats() {
  var total = db.prepare("SELECT COUNT(*) AS c FROM qa").get().c;
  var approved = db.prepare("SELECT COUNT(*) AS c FROM qa WHERE status='approved'").get().c;
  var pending = db.prepare("SELECT COUNT(*) AS c FROM qa WHERE status='pending'").get().c;
  var sourceA = db.prepare("SELECT COUNT(*) AS c FROM qa WHERE source='A' AND status='approved'").get().c;
  var sourceB = db.prepare("SELECT COUNT(*) AS c FROM qa WHERE source='B' AND status='approved'").get().c;
  var aiCalls = db.prepare("SELECT COUNT(*) AS c FROM ai_calls").get().c;
  var tokensRow = db.prepare("SELECT COALESCE(SUM(input_tokens),0) AS ti, COALESCE(SUM(output_tokens),0) AS to2 FROM ai_calls").get();
  var empQs = db.prepare("SELECT COUNT(*) AS c FROM employee_questions").get().c;
  return {
    total: total, approved: approved, pending: pending,
    a: sourceA, bApproved: sourceB,
    sourceA: sourceA, sourceB: sourceB,
    aiCalls: aiCalls,
    totalInputTokens: tokensRow.ti, totalOutputTokens: tokensRow.to2,
    employeeQuestions: empQs
  };
}

// ---------- Employee Questions ----------
function insertEmployeeQuestion(obj) {
  db.prepare("INSERT INTO employee_questions (employee_name, question, answer, model, input_tokens, output_tokens) VALUES (?,?,?,?,?,?)").run(
    obj.employeeName, obj.question, obj.answer, obj.model || null, obj.inputTokens || 0, obj.outputTokens || 0
  );
}
function countEmployeeQuestions() {
  return db.prepare("SELECT COUNT(*) AS c FROM employee_questions").get().c;
}
function listEmployeeQuestionsPaged(limit, offset) {
  return db.prepare("SELECT * FROM employee_questions ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset);
}
function listEmployeeQsFiltered(from, to) {
  if (from && to) {
    return db.prepare("SELECT * FROM employee_questions WHERE date(created_at) >= ? AND date(created_at) <= ? ORDER BY id DESC").all(from, to);
  } else if (from) {
    return db.prepare("SELECT * FROM employee_questions WHERE date(created_at) >= ? ORDER BY id DESC").all(from);
  } else if (to) {
    return db.prepare("SELECT * FROM employee_questions WHERE date(created_at) <= ? ORDER BY id DESC").all(to);
  }
  return db.prepare("SELECT * FROM employee_questions ORDER BY id DESC").all();
}

// ---------- Users ----------
function listUsers() {
  return db.prepare("SELECT id, username, role, display_name, otp_enabled, created_at FROM users ORDER BY id").all();
}
function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id=?").get(id);
}
function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username=?").get(username);
}
function getUserByToken(token) {
  if (!token) return null;
  var user = db.prepare("SELECT * FROM users WHERE session_token=?").get(token);
  if (!user) return null;
  if (user.session_expires && new Date(user.session_expires) < new Date()) {
    db.prepare("UPDATE users SET session_token=NULL, session_expires=NULL WHERE id=?").run(user.id);
    return null;
  }
  return user;
}
function setUserToken(userId, token) {
  if (token) {
    var expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE users SET session_token=?, session_expires=? WHERE id=?").run(token, expires, userId);
  } else {
    db.prepare("UPDATE users SET session_token=NULL, session_expires=NULL WHERE id=?").run(userId);
  }
}
function createUser(username, password, role, displayName) {
  var hash = crypto.createHash('sha256').update(password).digest('hex');
  db.prepare("INSERT INTO users (username, password_hash, role, display_name) VALUES (?,?,?,?)").run(username, hash, role, displayName || username);
}
function deleteUser(id) {
  db.prepare("DELETE FROM users WHERE id=?").run(id);
}
function authenticateUser(username, password) {
  var user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!user) return null;
  var parts = user.password_hash.split(':');
  var valid = false;
  if (parts.length === 2) {
    // salt:hash format
    var hash = crypto.createHash('sha256').update(password + parts[0]).digest('hex');
    valid = (hash === parts[1]);
  } else {
    // plain hash format
    var hash = crypto.createHash('sha256').update(password).digest('hex');
    valid = (hash === user.password_hash);
  }
  return valid ? user : null;
}
function changePassword(userId, newPassword) {
  var hash = crypto.createHash('sha256').update(newPassword).digest('hex');
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, userId);
}
function createSession(userId, role) {
  var token = crypto.randomBytes(32).toString('hex');
  var expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE users SET session_token=?, session_expires=? WHERE id=?").run(token, expires, userId);
  return { token: token, role: role };
}

// ---------- OTP ----------
function setOtpSecret(userId, secret) {
  db.prepare("UPDATE users SET otp_secret=?, otp_enabled=1 WHERE id=?").run(secret, userId);
}
function disableOtp(userId) {
  db.prepare("UPDATE users SET otp_secret=NULL, otp_enabled=0 WHERE id=?").run(userId);
}

// ---------- Import History ----------
function logImport(obj) {
  db.prepare("INSERT INTO import_history (filename, imported_count, skipped_count, error_count) VALUES (?,?,?,?)").run(
    obj.filename, obj.imported || 0, obj.skipped || 0, obj.errors || 0
  );
}
function listImportHistory() {
  return db.prepare("SELECT * FROM import_history ORDER BY id DESC LIMIT 50").all();
}

// ---------- Telegram ----------
function listTgRecipients() {
  return db.prepare("SELECT * FROM telegram_recipients ORDER BY id").all();
}
function addTgRecipient(chatId, label) {
  db.prepare("INSERT INTO telegram_recipients (chat_id, label) VALUES (?,?)").run(chatId, label || '');
}
function deleteTgRecipient(id) {
  db.prepare("DELETE FROM telegram_recipients WHERE id=?").run(id);
}

// ---------- Employees ----------
function listEmployees() {
  return db.prepare("SELECT * FROM employees ORDER BY full_name").all();
}
function addEmployee(fullName, phone) {
  var info = db.prepare("INSERT INTO employees (full_name, phone) VALUES (?,?)").run(fullName, phone || '');
  return db.prepare("SELECT * FROM employees WHERE id=?").get(info.lastInsertRowid);
}
function updateEmployee(id, fullName, phone) {
  db.prepare("UPDATE employees SET full_name=?, phone=? WHERE id=?").run(fullName, phone || '', id);
}
function deleteEmployee(id) {
  db.prepare("DELETE FROM employees WHERE id=?").run(id);
}

// ---------- Reminders ----------
function listReminders() {
  return db.prepare("SELECT * FROM reminders ORDER BY id DESC").all();
}
function addReminder(content, topic, promptId) {
  db.prepare("INSERT INTO reminders (content, topic, prompt_id) VALUES (?,?,?)").run(content, topic || null, promptId || null);
}
function updateReminder(id, content, topic) {
  db.prepare("UPDATE reminders SET content=?, topic=? WHERE id=?").run(content, topic || null, id);
}
function getReminder(id) {
  return db.prepare("SELECT * FROM reminders WHERE id=?").get(id);
}
function deleteReminder(id) {
  db.prepare("DELETE FROM reminders WHERE id=?").run(id);
}

module.exports = {
  db: db,
  listApproved: listApproved,
  listApprovedBySource: listApprovedBySource,
  listPending: listPending,
  listAllActive: listAllActive,
  getById: getById,
  insertQa: insertQa,
  updateQa: updateQa,
  approveQaToSource: approveQaToSource,
  incrementAskedCount: incrementAskedCount,
  deleteQa: deleteQa,
  deleteApprovedBySource: deleteApprovedBySource,
  listTopics: listTopics,
  logAiCall: logAiCall,
  getStats: getStats,
  insertEmployeeQuestion: insertEmployeeQuestion,
  countEmployeeQuestions: countEmployeeQuestions,
  listEmployeeQuestionsPaged: listEmployeeQuestionsPaged,
  listEmployeeQsFiltered: listEmployeeQsFiltered,
  listUsers: listUsers,
  getUserById: getUserById,
  getUserByUsername: getUserByUsername,
  getUserByToken: getUserByToken,
  setUserToken: setUserToken,
  createUser: createUser,
  deleteUser: deleteUser,
  authenticateUser: authenticateUser,
  changePassword: changePassword,
  createSession: createSession,
  setOtpSecret: setOtpSecret,
  disableOtp: disableOtp,
  logImport: logImport,
  listImportHistory: listImportHistory,
  listTgRecipients: listTgRecipients,
  addTgRecipient: addTgRecipient,
  deleteTgRecipient: deleteTgRecipient,
  listEmployees: listEmployees,
  addEmployee: addEmployee,
  updateEmployee: updateEmployee,
  deleteEmployee: deleteEmployee,
  listReminders: listReminders,
  addReminder: addReminder,
  updateReminder: updateReminder,
  getReminder: getReminder,
  deleteReminder: deleteReminder,
};
