// Admin routes v2.0.0
const { tokenize } = require('./search');
const { generateQAFromPrompt, chatWithAdmin, getModel, getProvider, getAllProviders } = require('./claude');
const settingsApi = require('./settings');
const { parseExcelBase64 } = require('./excel-parser');
const { generateSecret, verifyTOTP, generateURI } = require('./otp');

function registerAdminRoutes(route, sendJson, requireAdmin, dbApi) {
  console.log('[admin-routes] Dang dang ky routes...');

  // Import Excel
  route('POST', '/api/admin/import-excel', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var data = (body || {}).data;
    var filename = (body || {}).filename || 'unknown.xlsx';
    if (!data) return sendJson(res, 400, { error: 'Thieu data' });
    try {
      var parsed = parseExcelBase64(data);
      if (parsed.items.length === 0) return sendJson(res, 400, { error: 'Khong co cau hoi nao', errors: parsed.errors });
      var imported = 0, skipped = 0;
      var existing = new Set(dbApi.listApproved().map(function(q) { return q.question.toLowerCase().trim(); }));
      for (var i = 0; i < parsed.items.length; i++) {
        var item = parsed.items[i];
        if (existing.has(item.question.toLowerCase().trim())) { skipped++; continue; }
        dbApi.insertQa({
          question: item.question, answer: item.answer,
          source: 'A', status: 'approved',
          keywords: tokenize(item.question + ' ' + item.answer),
          topic: item.topic,
        });
        existing.add(item.question.toLowerCase().trim());
        imported++;
      }
      dbApi.logImport({ filename: filename, imported: imported, skipped: skipped, errors: parsed.errors.length });
      sendJson(res, 200, { imported: imported, skipped: skipped, errors: parsed.errors, total: parsed.items.length });
    } catch (err) {
      console.error('[import-excel]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // Import history
  route('GET', '/api/admin/import-history', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    sendJson(res, 200, { items: dbApi.listImportHistory() });
  });

  // Prompt -> AI sinh Q&A
  route('POST', '/api/admin/prompt', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var prompt = ((body || {}).prompt || '').trim();
    var topic = ((body || {}).topic || '').trim() || null;
    if (prompt.length < 10) return sendJson(res, 400, { error: 'Prompt qua ngan' });
    try {
      var result = await generateQAFromPrompt(prompt);
      settingsApi.savePrompt(prompt, topic);
      var inserted = 0;
      for (var j = 0; j < result.pairs.length; j++) {
        var p = result.pairs[j];
        if (!p.question || !p.answer) continue;
        dbApi.insertQa({ question: p.question, answer: p.answer, source: 'B', status: 'pending', keywords: tokenize(p.question + ' ' + p.answer), topic: p.topic || topic });
        inserted++;
      }
      dbApi.logAiCall({ query: '[prompt] ' + prompt.slice(0,100), qaId: null, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      sendJson(res, 200, { inserted: inserted, pairs: result.pairs, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    } catch (err) {
      console.error('[prompt]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // List prompts (knowledge)
  route('GET', '/api/admin/prompts', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    sendJson(res, 200, { items: settingsApi.listPrompts() });
  });

  // Create prompt (direct knowledge entry)
  route('POST', '/api/admin/prompts', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var content = ((body || {}).content || '').trim();
    var topic = ((body || {}).topic || '').trim();
    if (!content) return sendJson(res, 400, { error: 'Noi dung khong duoc de trong' });
    var saved = settingsApi.savePrompt(content, topic || null);
    sendJson(res, 200, { ok: true, item: saved, items: settingsApi.listPrompts() });
  });

  // Update prompt
  route('PUT', '/api/admin/prompts/:id', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var id = parseInt(ctx.params.id, 10);
    var content = ((ctx.body || {}).content || '').trim();
    var topic = ((ctx.body || {}).topic || '').trim();
    if (!content) return sendJson(res, 400, { error: 'Noi dung khong duoc de trong' });
    var existing = settingsApi.getPrompt(id);
    if (!existing) return sendJson(res, 404, { error: 'Khong tim thay' });
    var updated = settingsApi.updatePrompt(id, content, topic || null);
    sendJson(res, 200, { ok: true, item: updated, items: settingsApi.listPrompts() });
  });

  // Delete prompt
  route('DELETE', '/api/admin/prompts/:id', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var id = parseInt(ctx.params.id, 10);
    settingsApi.deletePrompt(id);
    sendJson(res, 200, { ok: true, items: settingsApi.listPrompts() });
  });

  // Export knowledge as Excel
  route('GET', '/api/admin/export-knowledge', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    try {
      var XLSX = require('xlsx');
      var items = settingsApi.listPrompts();
      var rows = items.map(function(it) {
        return {
          'ID': it.id,
          'Chu de': it.topic || '',
          'Noi dung': it.content || '',
          'Ngay tao': it.created_at || '',
        };
      });
      var ws = XLSX.utils.json_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Kien thuc AI');
      var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="knowledge.xlsx"',
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      console.error('[export-knowledge]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // Reminders (dan do AI)
  route('GET', '/api/admin/reminders', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    sendJson(res, 200, { items: dbApi.listReminders() });
  });
  route('DELETE', '/api/admin/reminders/:id', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    dbApi.deleteReminder(parseInt(ctx.params.id, 10));
    sendJson(res, 200, { ok: true, items: dbApi.listReminders() });
  });
  route('GET', '/api/admin/export-reminders', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    try {
      var XLSX = require('xlsx');
      var items = dbApi.listReminders();
      var rows = items.map(function(it) {
        return {
          'ID': it.id,
          'Noi dung dan do': it.content || '',
          'Chu de': it.topic || '',
          'Ngay gio': it.created_at || '',
        };
      });
      var ws = XLSX.utils.json_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Dan do AI');
      var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="reminders.xlsx"',
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      console.error('[export-reminders]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // Get settings
  route('GET', '/api/admin/settings', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var provider = getProvider();
    var key = settingsApi.getSetting('api_key_' + provider, null);
    if (!key && provider === 'claude') key = settingsApi.getActiveApiKey();
    var tgToken = settingsApi.getSetting('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');
    sendJson(res, 200, {
      provider: provider,
      model: getModel(),
      apiKeyMasked: settingsApi.maskKey(key),
      apiKeyLength: key ? key.length : 0,
      telegramBotToken: tgToken ? maskTgToken(tgToken) : '',
      telegramRecipients: dbApi.listTgRecipients(),
      availableProviders: getAllProviders(),
    });
  });

  function maskTgToken(token) {
    if (!token || token.length < 10) return '****';
    return token.slice(0, 3) + '***' + token.slice(-3);
  }

  // Update settings
  route('PUT', '/api/admin/settings', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var provider = (body || {}).provider;
    var model = (body || {}).model;
    var apiKey = (body || {}).apiKey;
    var tgToken = (body || {}).telegramBotToken;
    if (provider) settingsApi.setSetting('ai_provider', provider);
    if (model) settingsApi.setSetting('ai_model', model);
    if (apiKey) {
      var clean = apiKey.replace(/^\uFEFF/, '').replace(/[\s"']/g, '');
      var prov = provider || getProvider();
      if (prov === 'claude' && !clean.startsWith('sk-ant-')) return sendJson(res, 400, { error: 'Claude API key phai bat dau bang sk-ant-' });
      settingsApi.setSetting('api_key_' + prov, clean);
      if (prov === 'claude') settingsApi.setSetting('anthropic_api_key', clean);
    }
    if (typeof tgToken === 'string') settingsApi.setSetting('telegram_bot_token', tgToken.trim());
    sendJson(res, 200, { ok: true, provider: getProvider(), model: getModel() });
  });

  // Change admin password
  route('PUT', '/api/admin/change-password', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var oldPw = ((body || {}).oldPassword || '').trim();
    var newPw = ((body || {}).newPassword || '').trim();
    if (!newPw || newPw.length < 4) return sendJson(res, 400, { error: 'Mat khau moi phai co it nhat 4 ky tu' });
    // Find admin user and verify old password
    var adminUser = dbApi.authenticateUser('admin', oldPw);
    if (!adminUser) return sendJson(res, 400, { error: 'Mat khau cu khong dung' });
    dbApi.changePassword(adminUser.id, newPw);
    sendJson(res, 200, { ok: true });
  });

  // Telegram recipients CRUD
  route('POST', '/api/admin/telegram-recipients', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var chatId = ((body || {}).chatId || '').trim();
    var label = ((body || {}).label || '').trim();
    if (!chatId) return sendJson(res, 400, { error: 'Thieu chat ID' });
    dbApi.addTgRecipient(chatId, label);
    sendJson(res, 200, { ok: true, items: dbApi.listTgRecipients() });
  });
  route('DELETE', '/api/admin/telegram-recipients/:id', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    dbApi.deleteTgRecipient(parseInt(ctx.params.id, 10));
    sendJson(res, 200, { ok: true, items: dbApi.listTgRecipients() });
  });

  // Chat voi AI Agent
  route('POST', '/api/admin/chat', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var message = ((body || {}).message || '').trim();
    var history = (body || {}).history || [];
    if (!message) return sendJson(res, 400, { error: 'Thieu noi dung' });
    try {
      var result = await chatWithAdmin(message, history);
      var saved = null;
      try {
        // Try to find save_prompt JSON anywhere in reply (first few lines)
        var lines = result.reply.split('\n');
        var jsonLineIdx = -1;
        for (var li = 0; li < Math.min(lines.length, 5); li++) {
          var line = lines[li].trim();
          if (line.startsWith('{') && line.includes('save_prompt')) {
            try {
              var cmd = JSON.parse(line);
              if (cmd.action === 'save_prompt' && cmd.content) {
                saved = settingsApi.savePrompt(cmd.content, cmd.topic || null);
                jsonLineIdx = li;
                break;
              }
            } catch (_) {}
          }
        }
        // Also try regex extraction if JSON is embedded in text
        if (!saved) {
          var jsonMatch = result.reply.match(/\{"action"\s*:\s*"save_prompt"[^}]*\}/);
          if (jsonMatch) {
            try {
              var cmd2 = JSON.parse(jsonMatch[0]);
              if (cmd2.content) {
                saved = settingsApi.savePrompt(cmd2.content, cmd2.topic || null);
                result.reply = result.reply.replace(jsonMatch[0], '').trim();
              }
            } catch (_) {}
          }
        }
        if (jsonLineIdx >= 0) {
          lines.splice(jsonLineIdx, 1);
          result.reply = lines.join('\n').trim();
        }
      } catch (_) {}
      if (saved) {
        dbApi.addReminder(saved.content || '', saved.topic || null, saved.id || null);
      }
      dbApi.logAiCall({ query: '[chat] ' + message.slice(0,100), qaId: null, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
      sendJson(res, 200, { reply: result.reply, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, savedPrompt: saved });
    } catch (err) {
      console.error('[chat]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // Employee questions history with pagination & cost
  route('GET', '/api/admin/employee-questions', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var page = parseInt((ctx.query || {}).page || '1', 10);
    var limit = parseInt((ctx.query || {}).limit || '20', 10);
    if (limit < 5) limit = 5;
    if (limit > 200) limit = 200;
    if (page < 1) page = 1;
    var totalCount = dbApi.countEmployeeQuestions();
    var totalPages = Math.ceil(totalCount / limit) || 1;
    if (page > totalPages) page = totalPages;
    var offset = (page - 1) * limit;
    var items = dbApi.listEmployeeQuestionsPaged(limit, offset);
    // Calculate cost for each item
    var rate = settingsApi.getUsdToVnd();
    items = items.map(function(it) {
      var cost = settingsApi.calculateCost(it.input_tokens || 0, it.output_tokens || 0, it.model);
      it.cost_usd = cost.costUsd;
      it.cost_vnd = cost.costVnd;
      return it;
    });
    sendJson(res, 200, { items: items, page: page, limit: limit, totalCount: totalCount, totalPages: totalPages, usdToVnd: rate });
  });

  // Export employee history as Excel
  route('GET', '/api/admin/export-employee-history', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    try {
      var XLSX = require('xlsx');
      var from = (ctx.query || {}).from || '';
      var to = (ctx.query || {}).to || '';
      var items = dbApi.listEmployeeQsFiltered(from, to);
      var rate = settingsApi.getUsdToVnd();
      var rows = items.map(function(it) {
        var cost = settingsApi.calculateCost(it.input_tokens || 0, it.output_tokens || 0, it.model);
        return {
          'Nhan vien': it.employee_name,
          'Cau hoi': it.question,
          'Tra loi': it.answer,
          'Model': it.model || '',
          'Input tokens': it.input_tokens || 0,
          'Output tokens': it.output_tokens || 0,
          'Chi phi (USD)': cost.costUsd,
          'Chi phi (VND)': cost.costVnd,
          'Thoi gian': it.created_at || '',
        };
      });
      var ws = XLSX.utils.json_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Lich su NV');
      var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="employee-history.xlsx"',
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      console.error('[export-employee-history]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // Employee cost stats (grouped by employee, with date filter)
  // Tinh chi phi theo tung cau hoi (dung model thuc te), roi gop theo nhan vien
  route('GET', '/api/admin/employee-cost-stats', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var from = (ctx.query || {}).from || '';
    var to = (ctx.query || {}).to || '';
    var allItems = dbApi.listEmployeeQsFiltered(from, to);
    var rate = settingsApi.getUsdToVnd();
    // Group by employee, tinh chi phi tung dong voi model thuc te
    var map = {};
    allItems.forEach(function(it) {
      var name = it.employee_name;
      if (!map[name]) map[name] = { employee_name: name, count: 0, total_input: 0, total_output: 0, cost_usd: 0, cost_vnd: 0, first_ask: it.created_at, last_ask: it.created_at };
      var e = map[name];
      e.count++;
      e.total_input += (it.input_tokens || 0);
      e.total_output += (it.output_tokens || 0);
      var cost = settingsApi.calculateCost(it.input_tokens || 0, it.output_tokens || 0, it.model);
      e.cost_usd += cost.costUsd;
      e.cost_vnd += cost.costVnd;
      if (it.created_at < e.first_ask) e.first_ask = it.created_at;
      if (it.created_at > e.last_ask) e.last_ask = it.created_at;
    });
    var stats = Object.values(map).sort(function(a, b) { return (b.total_input + b.total_output) - (a.total_input + a.total_output); });
    stats.forEach(function(s) { s.total_tokens = s.total_input + s.total_output; });
    var totalCostUsd = stats.reduce(function(s, r) { return s + r.cost_usd; }, 0);
    var totalCostVnd = stats.reduce(function(s, r) { return s + r.cost_vnd; }, 0);
    sendJson(res, 200, { stats: stats, totalCostUsd: totalCostUsd, totalCostVnd: totalCostVnd, usdToVnd: rate, from: from, to: to });
  });

  // User management
  route('GET', '/api/admin/users', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    sendJson(res, 200, { items: dbApi.listUsers() });
  });
  route('POST', '/api/admin/users', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var username = ((body || {}).username || '').trim();
    var password = ((body || {}).password || '').trim();
    var role = ((body || {}).role || 'employee').trim();
    var displayName = ((body || {}).displayName || '').trim();
    if (!username || !password) return sendJson(res, 400, { error: 'Thieu username hoac password' });
    if (password.length < 6) return sendJson(res, 400, { error: 'Mat khau phai co it nhat 6 ky tu' });
    try {
      dbApi.createUser(username, password, role, displayName || username);
      sendJson(res, 200, { ok: true, items: dbApi.listUsers() });
    } catch (err) {
      sendJson(res, 400, { error: 'Username da ton tai' });
    }
  });
  route('DELETE', '/api/admin/users/:id', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var id = parseInt(ctx.params.id, 10);
    var user = dbApi.getUserById(id);
    if (!user) return sendJson(res, 404, { error: 'Khong tim thay user' });
    if (user.username === 'admin') return sendJson(res, 400, { error: 'Khong the xoa admin' });
    dbApi.deleteUser(id);
    sendJson(res, 200, { ok: true, items: dbApi.listUsers() });
  });

  // Auth login (session-based, with OTP support)
  route('POST', '/api/auth/login', async (req, res, { body }) => {
    var username = ((body || {}).username || '').trim();
    var password = ((body || {}).password || '').trim();
    // Support both field names: otp (admin.html) and otpCode (login.html)
    var otp = ((body || {}).otp || (body || {}).otpCode || '').trim();
    if (!username || !password) return sendJson(res, 400, { error: 'Thieu username hoac password' });
    var user = dbApi.authenticateUser(username, password);
    if (!user) return sendJson(res, 401, { error: 'Sai ten dang nhap hoac mat khau' });
    // Check OTP if enabled
    if (user.otp_enabled && user.otp_secret) {
      if (!otp) return sendJson(res, 200, { requireOtp: true });
      if (!verifyTOTP(user.otp_secret, otp)) return sendJson(res, 401, { error: 'Ma OTP khong dung hoac het han' });
    }
    var session = dbApi.createSession(user.id, user.role);
    sendJson(res, 200, { ok: true, token: session.token, role: user.role, username: user.username, displayName: user.display_name });
  });

  // Auth check (GET for admin.html)
  route('GET', '/api/auth/me', async (req, res) => {
    var token = (req.headers['authorization'] || '').replace('Bearer ', '');
    if (!token) return sendJson(res, 401, { error: 'Chua dang nhap' });
    var user = dbApi.getUserByToken(token);
    if (!user) return sendJson(res, 401, { error: 'Phien het han' });
    sendJson(res, 200, { ok: true, username: user.username, role: user.role, displayName: user.display_name });
  });

  // Auth verify (POST for login.html & index.html)
  route('POST', '/api/auth/verify', async (req, res, { body }) => {
    var token = ((body || {}).token || '').trim();
    if (!token) return sendJson(res, 401, { error: 'Chua dang nhap' });
    var user = dbApi.getUserByToken(token);
    if (!user) return sendJson(res, 401, { ok: false, error: 'Phien het han' });
    sendJson(res, 200, { ok: true, username: user.username, role: user.role, displayName: user.display_name });
  });

  // Employee names (public, for index.html validation)
  route('GET', '/api/employee-names', async (req, res) => {
    var emps = dbApi.listEmployees();
    sendJson(res, 200, { names: emps.map(function(e) { return e.full_name; }) });
  });

  // Employee CRUD
  route('GET', '/api/admin/employees', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    sendJson(res, 200, { items: dbApi.listEmployees() });
  });
  route('POST', '/api/admin/employees', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var fullName = ((body || {}).fullName || '').trim();
    var phone = ((body || {}).phone || '').trim();
    if (!fullName) return sendJson(res, 400, { error: 'Thieu ho ten' });
    var emp = dbApi.addEmployee(fullName, phone);
    sendJson(res, 200, { ok: true, item: emp, items: dbApi.listEmployees() });
  });
  route('PUT', '/api/admin/employees/:id', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var id = parseInt(ctx.params.id, 10);
    var fullName = ((ctx.body || {}).fullName || '').trim();
    var phone = ((ctx.body || {}).phone || '').trim();
    if (!fullName) return sendJson(res, 400, { error: 'Thieu ho ten' });
    dbApi.updateEmployee(id, fullName, phone);
    sendJson(res, 200, { ok: true, items: dbApi.listEmployees() });
  });
  route('DELETE', '/api/admin/employees/:id', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var id = parseInt(ctx.params.id, 10);
    dbApi.deleteEmployee(id);
    sendJson(res, 200, { ok: true, items: dbApi.listEmployees() });
  });

  // Delete all approved by source
  route('DELETE', '/api/admin/approved-source/:source', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var source = (ctx.params.source || '').toUpperCase();
    if (source !== 'A' && source !== 'B') return sendJson(res, 400, { error: 'Source phai la A hoac B' });
    var result = dbApi.deleteApprovedBySource(source);
    sendJson(res, 200, { ok: true, deleted: result.changes });
  });

  // Export approved by source (Excel)
  route('GET', '/api/admin/export-approved', async (req, res, ctx) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    try {
      var XLSX = require('xlsx');
      var source = ((ctx.query || {}).source || 'A').toUpperCase();
      if (source !== 'A' && source !== 'B') source = 'A';
      var items = dbApi.listApprovedBySource(source);
      var rows = items.map(function(q) {
        return {
          'ID': q.id,
          'Cau hoi': q.question,
          'Tra loi': q.answer,
          'Chu de': q.topic || '',
          'Nguon': q.source,
          'So lan hoi': q.asked_count || 0,
          'Ngay tao': q.created_at || '',
        };
      });
      var ws = XLSX.utils.json_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Bo ' + source);
      var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="approved_bo_' + source + '.xlsx"',
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      console.error('[export-approved]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // Export topic template (Excel)
  route('GET', '/api/admin/export-topic-template', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    try {
      var XLSX = require('xlsx');
      var approved = dbApi.listApproved();
      var rows = approved.map(function(q) {
        return { ID: q.id, 'Cau hoi': q.question, 'Chu de hien tai': q.topic || '', 'Chu de moi': '' };
      });
      var ws = XLSX.utils.json_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Topics');
      var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="topic-template.xlsx"',
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      console.error('[export-topic-template]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // Import topic Excel (bulk update topics)
  route('POST', '/api/admin/import-topic-excel', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var data = (body || {}).data;
    if (!data) return sendJson(res, 400, { error: 'Thieu data' });
    try {
      var XLSX = require('xlsx');
      var buf = Buffer.from(data, 'base64');
      var wb = XLSX.read(buf, { type: 'buffer' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws);
      var updated = 0, skipped = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var id = parseInt(row['ID'] || row['id'] || 0, 10);
        var newTopic = (row['Chu de moi'] || row['New Topic'] || '').toString().trim();
        if (!id || !newTopic) { skipped++; continue; }
        var doc = dbApi.getById(id);
        if (!doc || doc.status !== 'approved') { skipped++; continue; }
        dbApi.updateQa(id, { question: doc.question, answer: doc.answer, keywords: doc.keywords, topic: newTopic });
        updated++;
      }
      sendJson(res, 200, { updated: updated, skipped: skipped, total: rows.length });
    } catch (err) {
      console.error('[import-topic-excel]', err);
      sendJson(res, 500, { error: err.message });
    }
  });

  // ---------- OTP: setup ----------
  route('POST', '/api/admin/otp/setup', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var userId = (body || {}).userId;
    if (!userId) return sendJson(res, 400, { error: 'Thieu userId' });
    var user = dbApi.getUserById(userId);
    if (!user) return sendJson(res, 404, { error: 'Khong tim thay user' });
    var secret = generateSecret();
    var uri = generateURI(secret, user.username, 'HelloCon');
    sendJson(res, 200, { secret: secret, uri: uri });
  });

  // ---------- OTP: confirm (first-time verify + enable) ----------
  route('POST', '/api/admin/otp/confirm', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var userId = (body || {}).userId;
    var secret = ((body || {}).secret || '').trim();
    var code = ((body || {}).code || '').trim();
    if (!userId || !secret || !code) return sendJson(res, 400, { error: 'Thieu thong tin' });
    if (!verifyTOTP(secret, code)) return sendJson(res, 400, { error: 'Ma OTP khong dung. Vui long thu lai.' });
    dbApi.setOtpSecret(userId, secret);
    sendJson(res, 200, { ok: true });
  });

  // ---------- OTP: verify for download ----------
  route('POST', '/api/admin/otp/verify-download', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var code = ((body || {}).code || '').trim();
    if (!code) return sendJson(res, 400, { error: 'Thieu ma OTP' });
    var token = (req.headers['authorization'] || '').replace('Bearer ', '');
    var user = token ? dbApi.getUserByToken(token) : null;
    if (!user) return sendJson(res, 401, { error: 'Chua dang nhap' });
    if (!user.otp_enabled || !user.otp_secret) return sendJson(res, 200, { ok: true });
    if (!verifyTOTP(user.otp_secret, code)) return sendJson(res, 400, { error: 'Ma OTP khong dung hoac het han' });
    sendJson(res, 200, { ok: true });
  });

  // ---------- OTP: check if current user has OTP enabled ----------
  route('GET', '/api/admin/otp/status', async (req, res) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var token = (req.headers['authorization'] || '').replace('Bearer ', '');
    var user = token ? dbApi.getUserByToken(token) : null;
    if (!user) return sendJson(res, 200, { otpEnabled: false });
    sendJson(res, 200, { otpEnabled: !!(user.otp_enabled && user.otp_secret) });
  });

  // ---------- OTP: disable ----------
  route('POST', '/api/admin/otp/disable', async (req, res, { body }) => {
    if (!requireAdmin(req)) return sendJson(res, 401, { error: 'Sai mat khau admin' });
    var userId = (body || {}).userId;
    if (!userId) return sendJson(res, 400, { error: 'Thieu userId' });
    dbApi.disableOtp(userId);
    sendJson(res, 200, { ok: true });
  });

  console.log('[admin-routes] Da dang ky xong tat ca routes.');
}

module.exports = { registerAdminRoutes };
