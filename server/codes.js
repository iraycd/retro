// Crockford base32 minus ambiguous chars (0, O, I, L, U)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomCode(len) {
  let code = "";
  const bytes = require("crypto").randomBytes(len);
  for (let i = 0; i < len; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return "r-" + code;
}

function generateCode(len = 5) {
  return randomCode(len);
}

function isValidCode(s) {
  return typeof s === "string" && /^r-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5,6}$/.test(s);
}

module.exports = { generateCode, isValidCode };
