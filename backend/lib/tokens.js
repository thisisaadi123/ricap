// Random tokens for invite / reset links and login challenges, plus the
// hashing used to store them. Only hashes go in the database.
const crypto = require("crypto");

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Six digits, uniform, leading zeros kept ("004219").
function sixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// Codes are short, so they're hashed together with their challenge id;
// the same code in two challenges never produces the same hash.
function hashCode(challengeId, code) {
  return sha256(`${challengeId}:${code}`);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = { randomToken, sha256, sixDigitCode, hashCode, safeEqual };
