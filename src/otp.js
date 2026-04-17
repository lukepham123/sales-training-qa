// TOTP implementation for Google Authenticator (RFC 6238)
const crypto = require('node:crypto');

function generateSecret(length) {
  length = length || 20;
  var bytes = crypto.randomBytes(length);
  return base32Encode(bytes);
}

function base32Encode(buffer) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var bits = '';
  for (var i = 0; i < buffer.length; i++) {
    bits += buffer[i].toString(2).padStart(8, '0');
  }
  var result = '';
  for (var j = 0; j < bits.length; j += 5) {
    var chunk = bits.slice(j, j + 5);
    if (chunk.length < 5) chunk = chunk + '0'.repeat(5 - chunk.length);
    result += alphabet[parseInt(chunk, 2)];
  }
  return result;
}

function base32Decode(str) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  var bits = '';
  for (var i = 0; i < str.length; i++) {
    var val = alphabet.indexOf(str[i].toUpperCase());
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  var bytes = [];
  for (var j = 0; j + 8 <= bits.length; j += 8) {
    bytes.push(parseInt(bits.slice(j, j + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret, time) {
  var t = Math.floor((time || Date.now()) / 1000 / 30);
  var buf = Buffer.alloc(8);
  for (var i = 7; i >= 0; i--) {
    buf[i] = t & 0xff;
    t = t >> 8;
  }
  var key = base32Decode(secret);
  var hmac = crypto.createHmac('sha1', key).update(buf).digest();
  var offset = hmac[hmac.length - 1] & 0x0f;
  var code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset+1] & 0xff) << 16) | ((hmac[offset+2] & 0xff) << 8) | (hmac[offset+3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

function verifyTOTP(secret, code, window) {
  window = window || 3;
  var now = Date.now();
  for (var i = -window; i <= window; i++) {
    var t = now + i * 30000;
    if (generateTOTP(secret, t) === code) return true;
  }
  return false;
}

function generateURI(secret, account, issuer) {
  return 'otpauth://totp/' + encodeURIComponent(issuer || 'App') + ':' + encodeURIComponent(account) + '?secret=' + secret + '&issuer=' + encodeURIComponent(issuer || 'App') + '&algorithm=SHA1&digits=6&period=30';
}

module.exports = { generateSecret, generateTOTP, verifyTOTP, generateURI };
