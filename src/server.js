// HTTP server - dung node:http
require('./env').loadEnv();

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
// url module removed - using WHATWG URL API instead

const dbApi = require('./db');
const { tokenize, hybridSearch } = require('./search');
const { generateAnswer, getModel } = require('./claude');
const settingsApi = require('./settings');
const { registerAdminRoutes } = require('./admin-routes');
const { sendTelegramMessage, formatAiQuestionNotification } = require('./telegram');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ALPHA = parseFloat(process.env.SEARCH_ALPHA || '0.4');
const BETA = parseFloat(process.env.SEARCH_BETA || '0.6');
const MIN_SCORE = parseFloat(process.env.SEARCH_MIN_SCORE || '0.15');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function sendJson(res, status, data) {
  var body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, ct) {
  res.writeHead(status, { 'Content-Type': ct || 'text/plain; charset=utf-8' });
  res.end(text);
}

function parseBody(req, maxSize) {
  maxSize = maxSize || 10 * 1024 * 1024;
  return new Promise(function(resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function(c) {
      size += c.length;
      if (size > maxSize) { reject(new Error('Body qua lon')); return; }
      chunks.push(c);
    });
    req.on('end', function() {
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('JSON body khong hop le')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, relPath) {
  var filePath = path.join(PUBLIC_DIR, relPath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden');
  fs.stat(filePath, function(err, stat) {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not Found');
    var ext = path.extname(filePath).toLowerCase();
    var headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
    };
    if (ext === '.html') headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function requireAdmin(req) {
  // Legacy password auth
  if (req.headers['x-admin-password'] === ADMIN_PASSWORD) return true;
  // Session token auth
  var token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token) {
    var user = dbApi.getUserByToken(token);
    if (user && user.role === 'admin') return true;
  }
  return false;
}
function requireAuth(req) {
  var token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token) return dbApi.getUserByToken(token);
  if (req.headers['x-admin-password'] === ADMIN_PASSWORD) return { role: 'admin', username: 'admin' };
  return null;
}

// ---------- Security: rate limiting ----------
var loginAttempts = {};
var RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 phut
var RATE_LIMIT_MAX = 10; // toi da 10 lan/15 phut
function checkRateLimit(ip) {
  var now = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = [];
  loginAttempts[ip] = loginAttempts[ip].filter(function(t) { return now - t < RATE_LIMIT_WINDOW; });
  if (loginAttempts[ip].length >= RATE_LIMIT_MAX) return false;
  loginAttempts[ip].push(now);
  return true;
}
// Don dep rate limit moi 30 phut
setInterval(function() {
  var now = Date.now();
  Object.keys(loginAttempts).forEach(function(ip) {
    loginAttempts[ip] = loginAttempts[ip].filter(function(t) { return now - t < RATE_LIMIT_WINDOW; });
    if (loginAttempts[ip].length === 0) delete loginAttempts[ip];
  });
}, 30 * 60 * 1000);

// ---------- Routing ----------
var routes = [];
function route(method, pattern, handler) {
  var regex = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ method: method, regex: regex, handler: handler });
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

async function handleRequest(req, res) {
  setSecurityHeaders(res);
  var urlObj = new URL(req.url, 'http://localhost');
  var pathname = urlObj.pathname;
  var query = Object.fromEntries(urlObj.searchParams.entries());

  // Rate limit cho login va OTP
  if (req.method === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/admin/otp/verify-download')) {
    var clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return sendJson(res, 429, { error: 'Qua nhieu lan thu. Vui long doi 15 phut.' });
    }
  }

  for (var i = 0; i < routes.length; i++) {
    var r = routes[i];
    if (r.method !== req.method) continue;
    var m = pathname.match(r.regex);
    if (m) {
      try {
        var body = (req.method === 'GET' || req.method === 'DELETE') ? {} : await parseBody(req);
        await r.handler(req, res, { params: m.groups || {}, query: query, body: body });
      } catch (err) {
        console.error('[route error]', err);
        if (!res.headersSent) sendJson(res, 500, { error: 'Loi server' });
      }
      return;
    }
  }

  // Static files
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') return serveStatic(res, 'index.html');
    if (pathname === '/admin' || pathname === '/admin.html') return serveStatic(res, 'admin.html');
    if (/^\/[\w\-./]+\.(css|js|svg|png|ico|html|xlsx)$/.test(pathname)) return serveStatic(res, pathname.slice(1));
  }

  sendJson(res, 404, { error: 'Khong tim thay', path: pathname });
}

// ---------- API: tim kiem ----------
route('POST', '/api/search', async function(req, res, ctx) {
  var query = (ctx.body || {}).query;
  var topK = (ctx.body || {}).topK;
  var status = (ctx.body || {}).status;
  if (!query || typeof query !== 'string') return sendJson(res, 400, { error: 'Thieu tham so query' });
  var docs;
  if (status === 'pending') { docs = dbApi.listPending(); }
  else if (status === 'approved') { docs = dbApi.listApproved(); }
  else { docs = dbApi.listAllActive(); }
  var results = hybridSearch(query, docs, { alpha: ALPHA, beta: BETA, minScore: 0.01, topK: topK || 10 });
  sendJson(res, 200, {
    query: query,
    tokens: tokenize(query),
    count: results.length,
    results: results.map(function(r) {
      return {
        id: r.doc.id, question: r.doc.question, answer: r.doc.answer, source: r.doc.source,
        status: r.doc.status, topic: r.doc.topic, asked_count: r.doc.asked_count,
        created_at: r.doc.created_at,
        score: +r.score.toFixed(4), keywordScore: +r.keywordScore.toFixed(4), semanticScore: +r.semanticScore.toFixed(4),
      };
    }),
  });
});

// ---------- API: chi tiet ----------
route('GET', '/api/qa/:id', async function(req, res, ctx) {
  var id = parseInt(ctx.params.id, 10);
  var doc = dbApi.getById(id);
  if (!doc) return sendJson(res, 404, { error: 'Khong tim thay cau hoi' });
  dbApi.incrementAskedCount(id);
  sendJson(res, 200, doc);
});

// ---------- API: danh sach chu de ----------
route('GET', '/api/topics', async function(req, res) {
  sendJson(res, 200, { topics: dbApi.listTopics() });
});

// ---------- API: goi AI ----------
route('POST', '/api/ask-ai', async function(req, res, ctx) {
  var query = ((ctx.body || {}).query || '').trim();
  var employeeName = ((ctx.body || {}).employeeName || '').trim();
  if (query.length < 3) return sendJson(res, 400, { error: 'Cau hoi qua ngan' });
  if (!employeeName) return sendJson(res, 400, { error: 'Vui long nhap ho ten nhan vien' });
  // Validate employee name against registered employees list
  var employees = dbApi.listEmployees();
  if (employees.length > 0) {
    var nameNorm = employeeName.toLowerCase().trim();
    var found = employees.some(function(e) { return (e.full_name || '').toLowerCase().trim() === nameNorm; });
    if (!found) return sendJson(res, 403, { error: 'Ho ten khong dung. Vui long nhap dung ho va ten da dang ky voi admin.' });
  }
  try {
    var approvedA = dbApi.listApproved();
    var contextHits = hybridSearch(query, approvedA, { alpha: ALPHA, beta: BETA, minScore: 0.05, topK: 6 });
    var contextDocs = contextHits.map(function(h) { return h.doc; });
    var extraPrompts = settingsApi.listPrompts();
    var result = await generateAnswer(query, contextDocs, extraPrompts);
    var suggestedTopic = null;
    if (contextDocs.length > 0 && contextDocs[0].topic) {
      suggestedTopic = contextDocs[0].topic;
    }
    var inserted = dbApi.insertQa({
      question: query, answer: result.answer,
      source: 'B', status: 'pending',
      keywords: tokenize(query), topic: suggestedTopic,
    });
    dbApi.logAiCall({ query: query, qaId: inserted.id, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    dbApi.insertEmployeeQuestion({
      employeeName: employeeName, question: query, answer: result.answer,
      model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    });
    // Lookup employee phone for telegram notification
    var empPhone = '';
    var empList = dbApi.listEmployees();
    var nameNormTg = employeeName.toLowerCase().trim();
    for (var ei = 0; ei < empList.length; ei++) {
      if ((empList[ei].full_name || '').toLowerCase().trim() === nameNormTg) {
        empPhone = empList[ei].phone || '';
        break;
      }
    }
    sendTelegramMessage(formatAiQuestionNotification(employeeName, query, result.answer, result.model, empPhone))
      .catch(function(e) { console.error('[telegram async]', e.message); });
    sendJson(res, 200, {
      id: inserted.id, question: inserted.question, answer: result.answer,
      model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      suggestedTopic: suggestedTopic,
      topics: dbApi.listTopics(),
      contextIds: contextDocs.map(function(d) { return d.id; }),
      note: 'Cau hoi da duoc luu vao bo B, cho admin duyet.',
    });
  } catch (err) {
    console.error('[ask-ai error]', err);
    sendJson(res, 500, { error: err.message || 'Loi goi Claude API' });
  }
});

// ---------- API: NV cap nhat topic cho cau hoi AI ----------
route('PUT', '/api/qa/:id/topic', async function(req, res, ctx) {
  var id = parseInt(ctx.params.id, 10);
  var topic = ((ctx.body || {}).topic || '').trim();
  var doc = dbApi.getById(id);
  if (!doc) return sendJson(res, 404, { error: 'Khong tim thay cau hoi' });
  if (doc.source === 'B' && doc.status === 'pending') {
    dbApi.updateQa(id, { question: doc.question, answer: doc.answer, keywords: doc.keywords, topic: topic || null });
    sendJson(res, 200, { ok: true, topic: topic });
  } else {
    sendJson(res, 403, { error: 'Chi cap nhat topic cho cau hoi dang cho duyet' });
  }
});

// ---------- Admin: dang nhap ----------
route('POST', '/api/admin/login', async function(req, res, ctx) {
  if (((ctx.body || {}).password) === ADMIN_PASSWORD) return sendJson(res, 200, { ok: true });
  sendJson(res, 401, { error: 'Sai mat khau' });
});

// ---------- Admin: stats/pending/approved ----------
route('GET', '/api/admin/stats', async function(req, res) {
  if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
  var stats = dbApi.getStats();
  var cost = settingsApi.calculateCost(stats.totalInputTokens, stats.totalOutputTokens, getModel());
  sendJson(res, 200, Object.assign({}, stats, { model: getModel(), totalCostUsd: cost.costUsd, totalCostVnd: cost.costVnd }));
});
route('GET', '/api/admin/pending', async function(req, res) {
  if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
  sendJson(res, 200, { items: dbApi.listPending() });
});
route('GET', '/api/admin/approved', async function(req, res, ctx) {
  if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
  var source = ((ctx.query || {}).source || '').toUpperCase();
  if (source === 'A' || source === 'B') {
    sendJson(res, 200, { items: dbApi.listApprovedBySource(source) });
  } else {
    sendJson(res, 200, { items: dbApi.listApproved() });
  }
});

// ---------- Admin: duyet/sua/xoa ----------
route('POST', '/api/admin/approve/:id', async function(req, res, ctx) {
  if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
  var id = parseInt(ctx.params.id, 10);
  var doc = dbApi.getById(id);
  if (!doc) return sendJson(res, 404, { error: 'Khong tim thay' });
  var source = ((ctx.body || {}).source || 'A').toUpperCase();
  if (source !== 'A' && source !== 'B') source = 'A';
  sendJson(res, 200, dbApi.approveQaToSource(id, source));
});

// ---------- Register admin routes ----------
registerAdminRoutes(route, sendJson, requireAdmin, dbApi);

// ---------- Auth routes ----------
route('POST', '/api/auth/login', async function(req, res, ctx) {
  var username = ((ctx.body || {}).username || '').trim();
  var password = (ctx.body || {}).password || '';
  if (!username || !password) return sendJson(res, 400, { error: 'Thieu username hoac password' });
  var user = dbApi.getUserByUsername(username);
  if (!user || user.password_hash !== require('node:crypto').createHash('sha256').update(password).digest('hex')) {
    return sendJson(res, 401, { error: 'Sai ten dang nhap hoac mat khau' });
  }
  if (user.otp_enabled) {
    return sendJson(res, 200, { requireOtp: true, userId: user.id });
  }
  var token = require('node:crypto').randomBytes(32).toString('hex');
  dbApi.setUserToken(user.id, token);
  sendJson(res, 200, { ok: true, token: token, role: user.role, username: user.username, fullName: user.full_name });
});

route('POST', '/api/auth/login-otp', async function(req, res, ctx) {
  var userId = (ctx.body || {}).userId;
  var otpCode = ((ctx.body || {}).otp || '').trim();
  if (!userId || !otpCode) return sendJson(res, 400, { error: 'Thieu thong tin' });
  var user = dbApi.getUserById(userId);
  if (!user || !user.otp_enabled) return sendJson(res, 400, { error: 'OTP khong hop le' });
  if (!verifyTOTP(user.otp_secret, otpCode)) return sendJson(res, 401, { error: 'Ma OTP sai hoac het han' });
  var token = require('node:crypto').randomBytes(32).toString('hex');
  dbApi.setUserToken(user.id, token);
  sendJson(res, 200, { ok: true, token: token, role: user.role, username: user.username, fullName: user.full_name });
});

route('POST', '/api/auth/logout', async function(req, res) {
  var token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token) {
    var user = dbApi.getUserByToken(token);
    if (user) dbApi.setUserToken(user.id, null);
  }
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/auth/me', async function(req, res) {
  var user = requireAuth(req);
  if (!user) return sendJson(res, 401, { error: 'Chua dang nhap' });
  sendJson(res, 200, { role: user.role, username: user.username, fullName: user.full_name });
});

// ---------- Import verifyTOTP for auth ----------
var verifyTOTP = require('./otp').verifyTOTP;

// ---------- Start server ----------
var server = http.createServer(handleRequest);
server.listen(PORT, function() {
  console.log('[server] Running on http://localhost:' + PORT);
  console.log('[server] Model: ' + getModel());
});
