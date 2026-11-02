// Account statement (PRD 6.10, 6.14): worked out from the commitments and
// money records, per commitment, as of a date. Voided receipts never count.
const LIVE = ["Active", "On hold"];

async function statementFor(db, investorId, asOf) {
  const { rows: investor } = await db.query("SELECT coalesce(display_name, legal_name) AS name, legal_name FROM investors WHERE id = $1", [investorId]);
  const { rows } = await db.query(
    `SELECT c.id, to_char(c.created_at, 'YYYY-MM-DD') AS created_on, c.flow, c.stage, c.status, c.indicative_amount, c.committed_amount, c.shares_issued, c.share_certificate_no, c.funds_transferred_amount, c.funds_transferred_date,
            v.name AS vehicle_name, v.legal_entity
     FROM commitments c JOIN vehicles v ON v.id = c.vehicle_id
     WHERE c.investor_id = $1
     ORDER BY c.created_at`,
    [investorId]
  );
  const { rows: receipts } = await db.query(
    `SELECT m.commitment_id, m.amount, m.value_date, m.bank_reference FROM money_movements m
     WHERE m.commitment_id = ANY($1) AND m.type = 'Subscription payment' AND m.voided_at IS NULL AND m.value_date <= $2::date
     ORDER BY m.value_date, m.id`,
    [rows.map((r) => r.id), asOf]
  );
  const lines = rows.map((c) => {
    const payments = receipts.filter((m) => m.commitment_id === c.id);
    // IB investors pay the startup directly (MON-1), so RIV records the
    // transferred amount rather than receipts.
    const transferred = c.flow === "IB" && c.funds_transferred_date && new Date(c.funds_transferred_date) <= new Date(asOf) ? Number(c.funds_transferred_amount || 0) : 0;
    const paid = payments.reduce((s, m) => s + Number(m.amount), 0) + transferred;
    const committed = c.committed_amount === null ? null : Number(c.committed_amount);
    return {
      commitment_id: c.id, created_on: c.created_on, vehicle_name: c.vehicle_name, legal_entity: c.legal_entity, flow: c.flow, stage: c.stage, status: c.status,
      indicative: Number(c.indicative_amount || 0), committed, paid,
      live: LIVE.includes(c.status),
      outstanding: committed === null || !LIVE.includes(c.status) ? 0 : Math.max(0, committed - paid),
      shares_issued: c.shares_issued, share_certificate_no: c.share_certificate_no,
      payments: payments.map((m) => ({ amount: m.amount, value_date: m.value_date, reference: m.bank_reference })),
    };
  // Early interest that never got a figure isn't a position on a statement.
  }).filter((l) => l.paid > 0 || (l.created_on <= asOf && (l.committed !== null || l.flow === "Fund")));
  const sum = (k) => lines.reduce((s, l) => s + Number(l[k] || 0), 0);
  return {
    investor_name: investor[0]?.legal_name, as_of: asOf, lines,
    // A dropped commitment still shows what was paid, but no longer counts as committed.
    totals: { committed: lines.filter((l) => l.live).reduce((s, l) => s + Number(l.committed || 0), 0), paid: sum("paid"), outstanding: sum("outstanding") },
  };
}

module.exports = { statementFor };
