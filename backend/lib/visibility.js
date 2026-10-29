// Which vehicles partners and investors can see (PRD 6.14, 9.1, INV-7,
// LEG-10): open HoldCo / Fund vehicles and live IB deals (a live deal's
// vehicle is Open) flagged visible to them. Investors also don't see
// vehicles RIV has hidden from them individually.

// SQL condition on vehicles aliased "v" for a role. For investors, pass the
// investor id as the given parameter number.
function visibleSql(role, investorParam = null) {
  const open = `(v.status = 'Open')`;
  if (role === "partner") return `(${open} AND v.visible_to_partners)`;
  return `(${open} AND v.visible_to_investors
           AND NOT EXISTS (SELECT 1 FROM vehicle_visibility h WHERE h.vehicle_id = v.id AND h.investor_id = $${investorParam}))`;
}

async function isVisible(db, role, vehicleId, investorId = null) {
  const params = role === "investor" ? [vehicleId, investorId] : [vehicleId];
  const { rows } = await db.query(`SELECT 1 FROM vehicles v WHERE v.id = $1 AND ${visibleSql(role, 2)}`, params);
  return Boolean(rows[0]);
}

module.exports = { visibleSql, isVisible };
