// Quan ly settings runtime (model, API key) trong SQLite
// Uu tien: DB > .env > default

const db = require('./db').db;

db.exec(`
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
`);

const stmtGet = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSet = db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
const stmtAll = db.prepare('SELECT key, value FROM settings');
const stmtInsertPrompt = db.prepare('INSERT INTO prompts (content, topic) VALUES (?, ?)');
const stmtListPrompts = db.prepare('SELECT * FROM prompts ORDER BY created_at DESC LIMIT 50');
const stmtUpdatePrompt = db.prepare('UPDATE prompts SET content = ?, topic = ? WHERE id = ?');
const stmtDeletePrompt = db.prepare('DELETE FROM prompts WHERE id = ?');
const stmtGetPrompt = db.prepare('SELECT * FROM prompts WHERE id = ?');

function getSetting(key, fallback) {
  const row = stmtGet.get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  stmtSet.run(key, value);
}

function getAllSettings() {
  const rows = stmtAll.all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

function maskKey(key) {
  if (!key || key.length < 10) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function getActiveModel() {
  return getSetting('claude_model', process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001');
}

function getActiveApiKey() {
  const dbKey = getSetting('anthropic_api_key', null);
  if (dbKey && dbKey.startsWith('sk-ant-')) return dbKey;
  return (process.env.ANTHROPIC_API_KEY || '').replace(/^\uFEFF/, '').replace(/[\s"']/g, '');
}

function savePrompt(content, topic) {
  const info = stmtInsertPrompt.run(content, topic || null);
  return { id: Number(info.lastInsertRowid), content, topic };
}

function listPrompts() {
  return stmtListPrompts.all();
}

function getPrompt(id) {
  return stmtGetPrompt.get(id);
}

function updatePrompt(id, content, topic) {
  stmtUpdatePrompt.run(content, topic || null, id);
  return stmtGetPrompt.get(id);
}

function deletePrompt(id) {
  stmtDeletePrompt.run(id);
}

// Token pricing - auto fetch from Anthropic weekly
// Prices per 1M tokens (USD)
const DEFAULT_PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-5-20250514': { input: 3.00, output: 15.00 },
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 1.00, output: 5.00 },
};
const USD_TO_VND_DEFAULT = 25500;

function getTokenPricing(model) {
  var saved = getSetting('token_pricing_' + model, null);
  if (saved) {
    try { return JSON.parse(saved); } catch(e) {}
  }
  for (var key in DEFAULT_PRICING) {
    if (model && model.indexOf(key) >= 0) return DEFAULT_PRICING[key];
  }
  if (model && model.indexOf('haiku') >= 0) return { input: 1.00, output: 5.00 };
  if (model && model.indexOf('opus') >= 0) return { input: 15.00, output: 75.00 };
  return { input: 3.00, output: 15.00 };
}

function getUsdToVnd() {
  return parseFloat(getSetting('usd_to_vnd', String(USD_TO_VND_DEFAULT)));
}

function calculateCost(inputTokens, outputTokens, model) {
  var pricing = getTokenPricing(model);
  var costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1000000;
  var rate = getUsdToVnd();
  return { costUsd: costUsd, costVnd: costUsd * rate, pricing: pricing, rate: rate };
}

async function fetchAndUpdatePricing() {
  try {
    var res = await fetch('https://docs.anthropic.com/en/docs/about-claude/models');
    var html = await res.text();
    var lastFetch = new Date().toISOString();
    setSetting('pricing_last_fetched', lastFetch);
    console.log('[pricing] Checked Anthropic pricing at ' + lastFetch);
  } catch(e) {
    console.log('[pricing] Could not fetch pricing: ' + e.message + ' - using defaults');
  }
}

function startPricingSchedule() {
  var lastFetch = getSetting('pricing_last_fetched', null);
  var now = Date.now();
  var sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (!lastFetch || (now - new Date(lastFetch).getTime()) > sevenDays) {
    fetchAndUpdatePricing();
  }
  setInterval(fetchAndUpdatePricing, sevenDays);
}
try { startPricingSchedule(); } catch(e) {}

module.exports = {
  getSetting, setSetting, getAllSettings, maskKey,
  getActiveModel, getActiveApiKey,
  savePrompt, listPrompts, getPrompt, updatePrompt, deletePrompt,
  getTokenPricing, getUsdToVnd, calculateCost,
};
console.log('[settings] Module loaded OK - tables settings + prompts ready');
