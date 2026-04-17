// Gui thong bao Telegram - ho tro nhieu nguoi nhan
let _settings = null;
let _db = null;
function settings() { if (!_settings) _settings = require('./settings'); return _settings; }
function dbApi() { if (!_db) _db = require('./db'); return _db; }

function getBotToken() {
  return settings().getSetting('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');
}

// Lay tat ca chat IDs (tu bang telegram_recipients + legacy setting)
function getAllChatIds() {
  var ids = [];
  // Legacy single chat ID from settings
  var legacy = settings().getSetting('telegram_chat_id', process.env.TELEGRAM_CHAT_ID || '');
  if (legacy) ids.push(legacy);
  // Multi recipients from DB
  try {
    var recipients = dbApi().listTgRecipients();
    for (var i = 0; i < recipients.length; i++) {
      if (recipients[i].enabled && recipients[i].chat_id && ids.indexOf(recipients[i].chat_id) === -1) {
        ids.push(recipients[i].chat_id);
      }
    }
  } catch(e) {}
  return ids;
}

async function sendTelegramMessage(text) {
  var token = getBotToken();
  var chatIds = getAllChatIds();
  if (!token || chatIds.length === 0) {
    console.log('[telegram] Chua cau hinh bot token hoac chat id, bo qua.');
    return null;
  }
  var results = [];
  for (var i = 0; i < chatIds.length; i++) {
    try {
      var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatIds[i], text: text, parse_mode: 'HTML' }),
      });
      var data = await res.json();
      if (!data.ok) console.error('[telegram] Loi gui toi ' + chatIds[i] + ':', data.description);
      results.push(data);
    } catch (err) {
      console.error('[telegram] Loi ket noi ' + chatIds[i] + ':', err.message);
    }
  }
  return results;
}

function formatAiQuestionNotification(employeeName, question, answer, model, phone) {
  var phoneStr = phone ? ' (📞 ' + escapeHtml(phone) + ')' : '';
  var msg = '📩 <b>Nhân viên:</b> ' + escapeHtml(employeeName) + phoneStr + '\n';
  msg += '❓ <b>Câu hỏi:</b> ' + escapeHtml(question) + '\n';
  msg += '💬 <b>Trả lời:</b> ' + escapeHtml(answer) + '\n';
  msg += '🤖 <b>Model:</b> ' + escapeHtml(model || '');
  if (phone) {
    msg += '\n\n📞 <b>Liên hệ NV:</b> ' + escapeHtml(phone);
  }
  if (msg.length > 4000) msg = msg.slice(0, 4000) + '\n...(cắt bớt)';
  return msg;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { sendTelegramMessage, formatAiQuestionNotification, getBotToken, getAllChatIds };
