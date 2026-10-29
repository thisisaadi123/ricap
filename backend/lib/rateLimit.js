// Small in-memory sliding-window limiter, same idea as RIOS's forgot-password
// limiter. Per process only: on Netlify each function instance keeps its own
// counts, so this slows down guessing rather than stopping it outright. The
// hard limits that matter (5 attempts per login code, one-time links) are
// enforced in the database.
const buckets = new Map();

function hit(key, { limit, windowMs }) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

module.exports = { hit };
