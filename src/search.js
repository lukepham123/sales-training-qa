// Hybrid Search: keyword score + semantic score (giả lập bằng Jaccard token)
//
// Đây là bản MVP: chưa dùng embedding thật.
// Khi sẵn sàng, có thể thay `semanticScore()` bằng cosine similarity
// giữa vector embedding OpenAI/Voyage (xem mục "Lộ trình" trong README).

// --- Tokenize & chuẩn hoá tiếng Việt ---
function removeDiacritics(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

const STOPWORDS = new Set([
  // Tiếng Việt phổ biến - bỏ để không nhiễu
  'la','va','hay','cua','cho','khi','neu','nhu','thi','de','duoc','mot','cac','nhung','nay','do',
  've','voi','trong','ngoai','ra','vao','den','sau','truoc','ben','tai','giua',
  'toi','ban','anh','chi','em','ho','minh','chung','no',
  'co','khong','khong co','chua','da','se','dang','chua','co the','khong the','phai','nen',
  'gi','sao','the','nao','bao','bao gi','bao nhieu','dau','may',
  'a','o','u','y','i','e',
]);

function tokenize(text) {
  const normalized = removeDiacritics(text).toLowerCase();
  const raw = normalized
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
  return raw;
}

// --- Keyword score: tỷ lệ token trong query khớp với keywords đã lưu ---
function keywordScore(queryTokens, docKeywords) {
  if (!queryTokens.length) return 0;
  const docSet = new Set(docKeywords);
  let matched = 0;
  for (const t of queryTokens) {
    if (docSet.has(t)) {
      matched += 1;
      continue;
    }
    // Fuzzy: khớp substring với token độ dài >= 4
    if (t.length >= 4) {
      for (const k of docKeywords) {
        if (k.length >= 4 && (k.includes(t) || t.includes(k))) {
          matched += 0.5;
          break;
        }
      }
    }
  }
  return Math.min(1, matched / queryTokens.length);
}

// --- Semantic score (giả lập): Jaccard giữa token của query và token của câu hỏi lưu ---
function semanticScore(queryTokens, docQuestion) {
  const docTokens = new Set(tokenize(docQuestion));
  const qSet = new Set(queryTokens);
  if (qSet.size === 0 || docTokens.size === 0) return 0;
  let inter = 0;
  for (const t of qSet) if (docTokens.has(t)) inter += 1;
  const union = new Set([...qSet, ...docTokens]).size;
  return union === 0 ? 0 : inter / union;
}

// --- Word order score: đo thứ tự từ giống nhau giữa query và câu hỏi ---
function orderScore(queryTokens, docQuestion) {
  if (queryTokens.length < 2) return 0;
  const docTokens = tokenize(docQuestion);
  if (docTokens.length < 2) return 0;
  // Tìm vị trí xuất hiện đầu tiên của mỗi query token trong doc
  var positions = [];
  for (var i = 0; i < queryTokens.length; i++) {
    var idx = docTokens.indexOf(queryTokens[i]);
    if (idx === -1) {
      // Fuzzy match
      for (var j = 0; j < docTokens.length; j++) {
        if (queryTokens[i].length >= 4 && docTokens[j].length >= 4 &&
            (docTokens[j].includes(queryTokens[i]) || queryTokens[i].includes(docTokens[j]))) {
          idx = j; break;
        }
      }
    }
    if (idx >= 0) positions.push(idx);
  }
  if (positions.length < 2) return 0;
  // Đếm số cặp liên tiếp có thứ tự tăng (giống thứ tự query)
  var ordered = 0;
  for (var k = 1; k < positions.length; k++) {
    if (positions[k] > positions[k-1]) ordered++;
  }
  return ordered / (positions.length - 1);
}

// --- Match count bonus: nhiều từ trùng khớp thì điểm cao hơn ---
function matchCountScore(queryTokens, docQuestion) {
  if (queryTokens.length === 0) return 0;
  const docTokens = new Set(tokenize(docQuestion));
  var matched = 0;
  for (var i = 0; i < queryTokens.length; i++) {
    if (docTokens.has(queryTokens[i])) {
      matched++;
      continue;
    }
    // Fuzzy
    if (queryTokens[i].length >= 4) {
      for (const dt of docTokens) {
        if (dt.length >= 4 && (dt.includes(queryTokens[i]) || queryTokens[i].includes(dt))) {
          matched += 0.7;
          break;
        }
      }
    }
  }
  return Math.min(1, matched / queryTokens.length);
}

// --- Hybrid search ---
function hybridSearch(query, docs, opts = {}) {
  const alpha = opts.alpha ?? 0.25;   // keyword score (token trong keywords DB)
  const beta = opts.beta ?? 0.25;     // jaccard semantic
  const gamma = 0.30;                 // match count (so tu trung khop)
  const delta = 0.20;                 // word order (thu tu tu)
  const minScore = opts.minScore ?? 0.10;
  const topK = opts.topK ?? 10;

  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scored = docs.map(doc => {
    const ks = keywordScore(qTokens, doc.keywords || []);
    const ss = semanticScore(qTokens, doc.question);
    const ms = matchCountScore(qTokens, doc.question);
    const os = orderScore(qTokens, doc.question);
    const score = alpha * ks + beta * ss + gamma * ms + delta * os;
    return { doc, score, keywordScore: ks, semanticScore: ss };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(x => x.score >= minScore).slice(0, topK);
}

module.exports = {
  tokenize,
  removeDiacritics,
  keywordScore,
  semanticScore,
  hybridSearch,
};
