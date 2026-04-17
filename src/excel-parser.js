// Parse file Excel (.xlsx) upload thanh danh sach Q&A
// Frontend gui base64, backend decode + parse bang xlsx (SheetJS)

function parseExcelBase64(base64Data) {
  const XLSX = require('xlsx');
  const buf = Buffer.from(base64Data, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer' });

  // Doc sheet dau tien
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const results = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 vi dong 1 la header, index 0-based
    // Tim cot theo ten hoac thu tu
    const topic = (row['topic'] || row['Chủ đề (tuỳ chọn)'] || row['chu_de'] || row['Chu de'] || '').toString().trim();
    const question = (row['question'] || row['Câu hỏi *'] || row['cau_hoi'] || row['Cau hoi'] || '').toString().trim();
    const answer = (row['answer'] || row['Câu trả lời mẫu *'] || row['tra_loi'] || row['Tra loi'] || '').toString().trim();

    if (!question && !answer) continue; // bo dong trong
    if (!question) { errors.push('Dong ' + rowNum + ': thieu cau hoi'); continue; }
    if (!answer) { errors.push('Dong ' + rowNum + ': thieu cau tra loi'); continue; }

    results.push({ topic: topic || null, question, answer });
  }

  return { items: results, errors, sheetName };
}

module.exports = { parseExcelBase64 };
