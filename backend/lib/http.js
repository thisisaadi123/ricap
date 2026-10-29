// Small helpers so route handlers can throw instead of repeating
// try/catch + res.status(...) blocks.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function httpError(status, message) {
  return new HttpError(status, message);
}

// Wraps an async handler so a thrown error (or rejected promise) reaches
// Express's error handler, which turns HttpErrors into JSON replies.
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Runs fn(client) inside a transaction.
async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { HttpError, httpError, asyncRoute, inTransaction };
