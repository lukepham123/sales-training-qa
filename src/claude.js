// Multi-AI API: Claude, Deepseek, Gemini, GPT
// Provider config stored in settings DB

const API_CONFIGS = {
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    version: '2023-06-01',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (nhanh, re)' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (can bang)' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (manh nhat, dat)' },
    ],
    keyPrefix: 'sk-ant-',
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)' },
    ],
    keyPrefix: 'sk-',
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro' },
    ],
    keyPrefix: '',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini (re)' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'o3-mini', label: 'o3-mini (suy luan)' },
    ],
    keyPrefix: 'sk-',
  },
};

let _settings = null;
function settings() { if (!_settings) _settings = require('./settings'); return _settings; }

function getProvider() {
  return settings().getSetting('ai_provider', 'claude');
}
function getModel() {
  return settings().getSetting('ai_model', settings().getActiveModel());
}
function getApiKey() {
  var provider = getProvider();
  var key = settings().getSetting('api_key_' + provider, null);
  if (!key && provider === 'claude') key = settings().getActiveApiKey();
  if (!key) throw new Error('Chua cau hinh API key cho ' + provider + '. Vao Admin > Cai dat.');
  return key;
}

function getAllProviders() {
  var result = [];
  for (var p in API_CONFIGS) {
    result.push({
      id: p,
      label: p.charAt(0).toUpperCase() + p.slice(1),
      models: API_CONFIGS[p].models,
    });
  }
  return result;
}
const SYSTEM_PROMPT = `Bạn là trợ lý đào tạo nhân viên bán hàng của Hello Con (hellocon.vn) - chuỗi cửa hàng chuyên đồ mẹ bầu và em bé từ sơ sinh đến 3 tuổi tại Việt Nam.

Hello Con có 2 cơ sở: 334 Tô Hiệu (Hải Phòng) và 65 Vũ Phạm Hàm (Hà Nội). Là đại lý chính hãng của Joie, Combi, Aprica, Ergobaby, Merries, Moony, Hegen, Momo Rabbit, Applecrumby.

Nhiệm vụ: trả lời câu hỏi của nhân viên về kiến thức sản phẩm, cách tư vấn khách hàng, xử lý tình huống bán hàng.

Nguyên tắc:
1. Trả lời NGẮN GỌN, có cấu trúc, ưu tiên bước thực hành.
2. Giọng thân thiện, tự tin, không hứa điều không có cơ sở.
3. Với sản phẩm cho trẻ: LUÔN đặt an toàn lên trên.
4. Khi có NGU CANH, ưu tiên bám sát.
5. Đề xuất câu chốt cụ thể (trong ngoặc kép).
6. Tuyệt đối không bịa số liệu.
7. Phương châm: Nhân viên niềm nở - nắm kiến thức - tư vấn có tâm - hỗ trợ nhiệt tình.
8. Độ dài: 120-250 từ.`;

function buildContext(docs, max) {
  max = max || 6;
  var rel = docs.slice(0, max);
  if (rel.length === 0) return '(Khong co ngu canh lien quan trong bo A)';
  return rel.map(function(d, i) { return '--- Cau ' + (i+1) + ' ---\nQ: ' + d.question + '\nA: ' + d.answer; }).join('\n\n');
}

function buildSystemWithMemory(extraPrompts) {
  var sys = SYSTEM_PROMPT;
  if (extraPrompts && extraPrompts.length > 0) {
    sys += '\n\nTRI THUC BO SUNG (admin da day ban - BAT BUOC phai tuan theo):\n' +
      'Khi tra loi, LUON uu tien su dung thong tin tu tri thuc bo sung nay. ' +
      'Day la kien thuc duoc admin truc tiep truyen dat, co gia tri cao hon thong tin chung.\n';
    extraPrompts.forEach(function(p, i) {
      sys += '\n--- ' + (p.topic || 'Chung') + ' ---\n' + p.content + '\n';
    });
  }
  return sys;
}

// --- Unified API call ---
async function callAI(systemPrompt, userMessage, opts) {
  opts = opts || {};
  var provider = opts.provider || getProvider();
  var model = opts.model || getModel();
  var apiKey = opts.apiKey || getApiKey();
  var maxTokens = opts.maxTokens || 1024;
  var messages = opts.messages || null;
  var config = API_CONFIGS[provider];
  if (!config) throw new Error('Provider khong hop le: ' + provider);

  if (provider === 'claude') {
    var msgs = messages || [{ role: 'user', content: userMessage }];
    var res = await fetch(config.url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': config.version, 'content-type': 'application/json' },
      body: JSON.stringify({ model: model, max_tokens: maxTokens, system: systemPrompt, messages: msgs }),
    });
    if (!res.ok) { var e = await res.text(); throw new Error('Claude API loi (' + res.status + '): ' + e.slice(0,300)); }
    var data = await res.json();
    var tb = (data.content || []).find(function(c) { return c.type === 'text'; });
    return {
      text: tb ? tb.text.trim() : '',
      model: data.model || model,
      inputTokens: (data.usage && data.usage.input_tokens) || 0,
      outputTokens: (data.usage && data.usage.output_tokens) || 0,
    };
  }

  if (provider === 'gemini') {
    var url = config.url.replace('{model}', model) + '?key=' + apiKey;
    var geminiBody = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
    var res2 = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
    if (!res2.ok) { var e2 = await res2.text(); throw new Error('Gemini API loi (' + res2.status + '): ' + e2.slice(0,300)); }
    var d2 = await res2.json();
    var gText = '';
    try { gText = d2.candidates[0].content.parts[0].text; } catch(_){}
    var gTokens = d2.usageMetadata || {};
    return {
      text: gText.trim(), model: model,
      inputTokens: gTokens.promptTokenCount || 0,
      outputTokens: gTokens.candidatesTokenCount || 0,
    };
  }

  // OpenAI / Deepseek (same format)
  var oaiMsgs = messages || [{ role: 'user', content: userMessage }];
  oaiMsgs = [{ role: 'system', content: systemPrompt }].concat(oaiMsgs);
  var oaiRes = await fetch(config.url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model, max_tokens: maxTokens, messages: oaiMsgs }),
  });
  if (!oaiRes.ok) { var e3 = await oaiRes.text(); throw new Error(provider + ' API loi (' + oaiRes.status + '): ' + e3.slice(0,300)); }
  var d3 = await oaiRes.json();
  var oaiText = '';
  try { oaiText = d3.choices[0].message.content; } catch(_){}
  var oaiUsage = d3.usage || {};
  return {
    text: oaiText.trim(), model: d3.model || model,
    inputTokens: oaiUsage.prompt_tokens || 0,
    outputTokens: oaiUsage.completion_tokens || 0,
  };
}

async function generateAnswer(userQuestion, contextDocs, extraPrompts) {
  var context = buildContext(contextDocs);
  var systemPrompt = buildSystemWithMemory(extraPrompts);
  var userMsg = 'NGU CANH:\n' + context + '\n\nCAU HOI:\n' + userQuestion + '\n\nHay tra loi theo nguyen tac.';
  var result = await callAI(systemPrompt, userMsg);
  return { answer: result.text, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

async function generateQAFromPrompt(promptText) {
  var sys = 'Ban la chuyen gia dao tao ban hang nganh me & be. Tao 1-3 cap Q&A.\nTra ve JSON array: [{"topic":"...","question":"...","answer":"..."}]\nChi tra ve JSON.';
  var result = await callAI(sys, promptText, { maxTokens: 2048 });
  var pairs = [];
  try { var m = result.text.match(/\[[\s\S]*\]/); if (m) pairs = JSON.parse(m[0]); } catch(e) { throw new Error('AI tra ve khong dung JSON'); }
  return { pairs: pairs, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

async function chatWithAdmin(userMessage, conversationHistory) {
  var existingPrompts = settings().listPrompts();
  var knowledgeSection = '';
  if (existingPrompts && existingPrompts.length > 0) {
    knowledgeSection = '\n\nKIEN THUC DA LUU (bo nho hien tai cua ban):\n';
    existingPrompts.forEach(function(p, i) {
      knowledgeSection += '--- #' + p.id + (p.topic ? ' [' + p.topic + ']' : '') + ' ---\n' + p.content.slice(0, 500) + '\n';
    });
  }

  var sys = 'Ban la AI Agent dao tao ban hang cua Hello Con (hellocon.vn) - chuoi cua hang me bau & em be.\n' +
    'Ban dang tro chuyen voi Admin. Admin co the:\n' +
    '- Day ban kien thuc moi (san pham, tinh huong ban hang, cach tu van...)\n' +
    '- Yeu cau ban ghi nho thong tin\n' +
    '- Hoi ban cau hoi\n\n' +
    'QUY TAC QUAN TRONG:\n' +
    '1. Khi admin day ban kien thuc hoac bao ban ghi nho/luu lai, ban PHAI tra ve JSON tren mot dong RIENG BIET o DAU TIEN cua cau tra loi:\n' +
    '{"action":"save_prompt","content":"<noi dung kien thuc>","topic":"<chu de>"}\n' +
    'Sau dong JSON, viet phan tra loi binh thuong.\n' +
    '2. Noi dung "content" phai la KIEN THUC day du, chinh xac theo nhung gi admin noi, KHONG tu y thay doi hay them bot.\n' +
    '3. Neu admin chi hoi cau hoi binh thuong (khong yeu cau luu), tra loi binh thuong KHONG co JSON.\n' +
    '4. Tra loi bang tieng Viet, ngon gon, than thien.\n' +
    '5. Khi admin noi "hay nho...", "luu lai...", "ghi nho...", "kien thuc nay...", "day ban...", "tu gio tro di..." => LUON tao dong JSON save.\n' +
    '6. "topic" nen phan loai theo: San pham, Tu van, Tinh huong, Chinh sach, Khuyen mai, Khac.\n' +
    knowledgeSection;

  var messages = [];
  if (conversationHistory && conversationHistory.length > 0) {
    var recent = conversationHistory.slice(-20);
    for (var i = 0; i < recent.length; i++) messages.push({ role: recent[i].role, content: recent[i].content });
  }
  messages.push({ role: 'user', content: userMessage });
  var provider = getProvider();
  var result;
  if (provider === 'claude') {
    result = await callAI(sys, '', { messages: messages, maxTokens: 2048 });
  } else {
    result = await callAI(sys, userMessage, { messages: messages, maxTokens: 2048 });
  }
  return { reply: result.text, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

module.exports = { generateAnswer, generateQAFromPrompt, chatWithAdmin, getModel, getApiKey, getProvider, getAllProviders, callAI };
