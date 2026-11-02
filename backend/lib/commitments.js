// Commitment engine (PRD 6.5-6.8, 7): the stages of each flow, the
// eligibility check, the evidence each stage needs, and moving a commitment
// forward one stage at a time.
const { httpError } = require("./http.js");
const { logAudit } = require("./audit.js");

const { notifyInvestor, notifyPartner, notifyAdmins } = require("./notify.js");

const FLOWS = {
  HoldCo: ["Intent", "Eligible", "Offer documents issued", "Signed by investor", "Fully executed", "Funds due", "Funds received", "Shares issued", "Active shareholder"],
  Fund: ["Intent", "Eligible", "Soft commitment", "Soft commitment confirmed", "Awaiting Fund launch"],
  IB: ["Intent", "Eligible", "NDA signed", "Diligence", "Term sheet", "Definitive documents signed", "Funds transferred", "Closed"],
};
const FLOW_FOR_VEHICLE = { HoldCo: "HoldCo", Fund: "Fund", "IB Deal": "IB" };
const EXIT_STATUSES = ["On hold", "Dropped", "Rejected", "Withdrawn"];

function nextStage(flow, stage) {
  const stages = FLOWS[flow];
  const i = stages.indexOf(stage);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1] : null;
}

function stageIndex(flow, stage) {
  return FLOWS[flow].indexOf(stage);
}

// Everything the engine needs about a commitment in one row.
async function loadCommitment(db, id, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT c.*,
            v.type AS vehicle_type, v.name AS vehicle_name, v.status AS vehicle_status, v.legal_entity,
            v.min_ticket_individual, v.min_ticket_entity, v.eligible_classifications,
            v.bank_name, v.bank_account_name, v.bank_iban, v.bank_swift, v.bank_approved_at,
            i.kind AS investor_kind, i.registration_status AS investor_status,
            coalesce(i.display_name, i.legal_name) AS investor_name,
            k.status AS kyc_status, k.refresh_due AS kyc_refresh_due, k.classification AS kyc_classification,
            coalesce(k.status = 'Cleared' AND k.refresh_due >= current_date, false) AS kyc_ok,
            p.full_name AS partner_name,
            coalesce((SELECT sum(m.amount) FROM money_movements m
                      WHERE m.commitment_id = c.id AND m.type = 'Subscription payment' AND m.voided_at IS NULL), 0)::numeric AS received_total
     FROM commitments c
     JOIN vehicles v ON v.id = c.vehicle_id
     JOIN investors i ON i.id = c.investor_id
     LEFT JOIN kyc_files k ON k.investor_id = i.id AND k.is_current
     LEFT JOIN venture_partners p ON p.id = c.partner_id
     WHERE c.id = $1 ${lock ? "FOR UPDATE OF c" : ""}`,
    [id]
  );
  if (!rows[0]) throw httpError(404, "Commitment not found.");
  return rows[0];
}

function amountFor(c) {
  return Number(c.committed_amount ?? c.indicative_amount);
}

// Eligibility (PRD 6.5 step 2, PRD 7): approved investor, KYC cleared and
// not expired, amount at least the vehicle's minimum for this investor kind
// (unless an admin overrode it with a reason), classification allowed.
function checkEligibility(c) {
  // Computed in SQL (current_date) to avoid time-zone edge cases.
  const kycOk = Boolean(c.kyc_ok);
  const min = c.investor_kind === "Individual" ? c.min_ticket_individual : c.min_ticket_entity;
  const amount = amountFor(c);
  const minOk = min === null || min === undefined || amount >= Number(min);
  const classes = c.eligible_classifications || [];
  const classOk = !classes.length || classes.includes(c.kyc_classification);
  const checks = [
    { key: "investor", label: "Investor approved", ok: c.investor_status === "Approved" },
    {
      key: "kyc", label: "KYC cleared and not expired", ok: kycOk,
      detail: kycOk ? null : c.kyc_status === "Cleared" ? "KYC has expired; open a refresh." : `KYC is ${c.kyc_status ? c.kyc_status.toLowerCase() : "not started"}.`,
    },
    {
      key: "minimum", label: min ? `At least the minimum ticket (USD ${Number(min).toLocaleString("en-US")} for ${c.investor_kind === "Individual" ? "individuals" : "entities"})` : "No minimum ticket",
      ok: minOk || Boolean(c.min_override_reason),
      detail: minOk ? null : c.min_override_reason ? `Below minimum; overridden: ${c.min_override_reason}` : `USD ${amount.toLocaleString("en-US")} is below the minimum.`,
    },
    {
      key: "classification", label: classes.length ? `Classified as ${classes.join(" or ")}` : "Any investor classification", ok: classOk,
      detail: classOk ? null : `KYC classification is ${c.kyc_classification || "not set"}.`,
    },
  ];
  return { pass: checks.every((x) => x.ok), checks };
}

// Required evidence documents for a stage and whether each is present.
async function evidenceFor(db, c, stage) {
  const { rows: reqs } = await db.query(
    "SELECT id, label, doc_type FROM stage_requirements WHERE flow = $1 AND stage = $2 AND required ORDER BY sort_order, id",
    [c.flow, stage]
  );
  if (!reqs.length) return [];
  const { rows: docs } = await db.query(
    `SELECT id, doc_type, title, filename, signature_status, uploaded_at FROM documents
     WHERE linked_type = 'commitment' AND linked_id = $1 AND evidence_stage = $2 AND voided_at IS NULL`,
    [c.id, stage]
  );
  return reqs.map((r) => {
    const matching = docs.filter((d) => d.doc_type === r.doc_type);
    return { ...r, met: matching.length > 0, documents: matching };
  });
}

// What else (besides evidence documents) a stage needs. Returns a list of
// plain-language problems; empty means ready.
async function extraNeeds(db, c, toStage, body) {
  const needs = [];
  const committed = body.committed_amount !== undefined && body.committed_amount !== null && body.committed_amount !== ""
    ? Number(body.committed_amount) : c.committed_amount !== null ? Number(c.committed_amount) : null;

  if (toStage === "Eligible") {
    const e = checkEligibility(c);
    for (const x of e.checks.filter((y) => !y.ok)) needs.push(x.detail || x.label);
  }
  if (toStage === "Fully executed" || toStage === "Definitive documents signed") {
    if (!committed || committed <= 0) needs.push("Enter the committed amount.");
  }
  if (toStage === "Funds due") {
    const { rows } = await db.query("SELECT 1 FROM payment_instructions WHERE commitment_id = $1 AND voided_at IS NULL", [c.id]);
    if (!rows[0]) needs.push("Issue payment instructions.");
  }
  if (toStage === "Funds received") {
    if (Number(c.received_total) < Number(c.committed_amount)) needs.push(`Record receipts covering the full USD ${Number(c.committed_amount).toLocaleString("en-US")} (received so far: USD ${Number(c.received_total).toLocaleString("en-US")}).`);
  }
  if (toStage === "Shares issued") {
    const shares = body.shares_issued ?? c.shares_issued;
    const cert = body.share_certificate_no ?? c.share_certificate_no;
    if (!shares || Number(shares) <= 0) needs.push("Enter the number of shares issued.");
    if (!cert) needs.push("Enter the share certificate number.");
  }
  if (toStage === "Soft commitment confirmed" && !c.soft_confirmed_at) {
    needs.push("The investor confirms in the portal, or record their email confirmation.");
  }
  // IB deals (PRD 6.8.2).
  if (toStage === "Diligence" && !c.data_room_granted_at) needs.push("Grant the investor data-room access.");
  if (toStage === "Funds transferred") {
    const amt = body.funds_transferred_amount ?? c.funds_transferred_amount;
    const date = body.funds_transferred_date ?? c.funds_transferred_date;
    if (!amt || Number(amt) <= 0) needs.push("Enter the amount the startup confirms it received.");
    if (!date) needs.push("Enter the date the startup received it.");
  }
  return needs;
}

async function readiness(db, c, toStage, body = {}) {
  const evidence = await evidenceFor(db, c, toStage);
  const needs = await extraNeeds(db, c, toStage, body);
  const missingDocs = evidence.filter((e) => !e.met).map((e) => `Upload "${e.label}".`);
  return { evidence, needs: [...missingDocs, ...needs], ready: !missingDocs.length && !needs.length };
}

async function recordEvent(db, c, { toStage = null, toStatus = null, note = null, actorId }) {
  await db.query(
    `INSERT INTO commitment_events (commitment_id, from_stage, to_stage, from_status, to_status, note, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.id, toStage ? c.stage : null, toStage, toStatus ? c.status : null, toStatus, note, actorId]
  );
}

// Moves a commitment one stage forward, after checking everything that
// stage needs. Only the next stage is allowed; stages are never skipped.
async function advance(db, c, { toStage, body = {}, actorId, req, note = null }) {
  if (c.status !== "Active") throw httpError(400, `This commitment is ${c.status.toLowerCase()}. Reopen it first.`);
  const expected = nextStage(c.flow, c.stage);
  if (!expected) throw httpError(400, "This commitment is already at its last stage.");
  if (toStage !== expected) throw httpError(400, `The next stage is "${expected}".`);

  const r = await readiness(db, c, toStage, body);
  if (!r.ready) throw httpError(400, `Not ready for "${toStage}": ${r.needs.join(" ")}`);

  const sets = ["stage = $2", "updated_at = now()", "updated_by = $3"];
  const params = [c.id, toStage, actorId];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if ((toStage === "Fully executed" || toStage === "Definitive documents signed") && body.committed_amount) add("committed_amount", Number(body.committed_amount));
  if (toStage === "Funds transferred") {
    if (body.funds_transferred_amount) add("funds_transferred_amount", Number(body.funds_transferred_amount));
    if (body.funds_transferred_date) add("funds_transferred_date", body.funds_transferred_date);
  }
  if (toStage === "Shares issued") {
    if (body.shares_issued) add("shares_issued", Number(body.shares_issued));
    if (body.share_certificate_no) add("share_certificate_no", String(body.share_certificate_no).slice(0, 100));
  }
  if (toStage === "Eligible") {
    add("eligibility", JSON.stringify(checkEligibility(c)));
    sets.push("eligibility_checked_at = now()");
  }
  const { rows } = await db.query(`UPDATE commitments SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  await recordEvent(db, c, { toStage, note, actorId });
  await logAudit({ actorId, action: "commitment.stage_changed", objectType: "commitment", objectId: c.id, details: { from: c.stage, to: toStage }, req }, db);
  await require("./payouts.js").refreshPayout(db, c.id, { actorId, req });
  await alertStageChange(db, c, toStage);
  return rows[0];
}

// Stages where the investor has something to do: these also get an email.
// Keep bank details out; they're only ever shown in the portal (PRD 7).
const INVESTOR_ACTIONS = {
  "Offer documents issued": "Your offer documents are ready. Please sign in and sign the Subscription Agreement and Shareholders' Agreement.",
  "Funds due": "Your payment instructions are ready. Please sign in to see the amount, due date and bank details.",
  "Soft commitment": "RIV has recorded your soft commitment. Please sign in to confirm it.",
  "Definitive documents signed": "The definitive documents are signed. Please pay the startup directly as agreed, then upload your payment confirmation.",
};
// The investor just did this themselves, or there's nothing to tell them yet.
const NO_INVESTOR_ALERT = ["Eligible", "Soft commitment confirmed"];

async function alertStageChange(db, c, toStage) {
  const action = INVESTOR_ACTIONS[toStage];
  if (!NO_INVESTOR_ALERT.includes(toStage)) {
    await notifyInvestor(db, c.investor_id, {
      type: "stage", title: `${c.vehicle_name}: ${toStage}`, body: action || investorNextAction({ ...c, stage: toStage }),
      linkView: "investments", linkId: c.id, email: Boolean(action), emailSubject: `RICap: action needed on ${c.vehicle_name}`,
    });
  }
  await notifyPartner(db, c.partner_id, {
    type: "stage_partner", title: `${c.investor_name}: ${toStage}`, body: c.vehicle_name, linkView: "commitments", linkId: c.id,
  });
}

// Re-runs eligibility; an Intent that now passes moves to Eligible.
async function recheck(db, id, { actorId, req }) {
  const c = await loadCommitment(db, id, { lock: true });
  const result = checkEligibility(c);
  await db.query("UPDATE commitments SET eligibility = $2, eligibility_checked_at = now() WHERE id = $1", [id, JSON.stringify(result)]);
  if (result.pass && c.stage === "Intent" && c.status === "Active") {
    await advance(db, { ...c, eligibility: result }, { toStage: "Eligible", actorId, req, note: "Eligibility check passed" });
  }
  return result;
}

// Creates a commitment (Intent) for an approved investor in an open
// vehicle, from the admin, a partner or the investor portal (PRD 6.5,
// 6.14). Partner credit is copied from the investor while it lasts.
async function createCommitment(db, { investorId, vehicleId, amount, createdVia, actorId, note = null, expectedCloseDate = null, req }) {
  const { rows: inv } = await db.query("SELECT * FROM investors WHERE id = $1", [investorId]);
  const investor = inv[0];
  if (!investor) throw httpError(404, "Investor not found.");
  if (investor.registration_status !== "Approved") throw httpError(400, "Only approved investors can make commitments.");
  const { rows: veh } = await db.query("SELECT * FROM vehicles WHERE id = $1", [vehicleId]);
  const vehicle = veh[0];
  if (!vehicle) throw httpError(404, "Vehicle not found.");
  await assertVehicleOpen(db, vehicle);

  const creditActive = investor.partner_id && investor.credit_expires_at && new Date(investor.credit_expires_at) > new Date();
  let created;
  try {
    const { rows } = await db.query(
      `INSERT INTO commitments (investor_id, vehicle_id, flow, source, partner_id, created_via, indicative_amount, expected_close_date, investor_note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
      [investorId, vehicleId, FLOW_FOR_VEHICLE[vehicle.type], investor.source, creditActive ? investor.partner_id : null, createdVia, amount, expectedCloseDate, note, actorId]
    );
    created = rows[0];
  } catch (err) {
    if (err.code === "23505") throw httpError(409, "This investor already has a live commitment for this vehicle.");
    throw err;
  }
  await db.query(
    "INSERT INTO commitment_events (commitment_id, to_stage, to_status, note, actor_user_id) VALUES ($1, 'Intent', 'Active', $2, $3)",
    [created.id, `Created via ${createdVia}`, actorId]
  );
  await logAudit({ actorId, action: "commitment.created", objectType: "commitment", objectId: created.id, details: { investor: investor.legal_name, vehicle: vehicle.name, amount, via: createdVia }, req }, db);
  await recheck(db, created.id, { actorId, req });
  await require("./payouts.js").refreshPayout(db, created.id, { actorId, req });
  if (createdVia !== "Admin") {
    await notifyAdmins(db, {
      type: "interest", title: `${investor.display_name || investor.legal_name} is interested in ${vehicle.name}`,
      body: `USD ${Number(amount).toLocaleString("en-US")}, via ${createdVia === "Partner" ? "their venture partner" : "the investor portal"}.`, linkView: "commitments", linkId: created.id,
    });
  }
  return created.id;
}

// HoldCo / Fund must be Open; IB deals must be Live (PRD 6.8.1).
async function assertVehicleOpen(db, vehicle) {
  if (vehicle.type === "IB Deal") return require("./deals.js").assertDealLive(db, vehicle);
  if (vehicle.status !== "Open") throw httpError(400, `${vehicle.name} isn't open for commitments.`);
}

// What the investor should do next, in plain words (PRD 6.14).
function investorNextAction(c, { instruction } = {}) {
  if (c.status !== "Active") return c.status === "On hold" ? "On hold. RIV will be in touch." : null;
  const outstanding = Number(c.committed_amount || 0) - Number(c.received_total || 0);
  switch (c.stage) {
    case "Intent": return c.kyc_status === "Cleared" ? "RIV is reviewing your interest." : "Complete your KYC so RIV can take this forward.";
    case "Eligible": return c.flow === "IB" ? "RIV will send you the NDA to sign." : c.flow === "Fund" ? "RIV will record your soft commitment." : "RIV will send you the offer documents.";
    case "Offer documents issued": return "Sign the Subscription Agreement and Shareholders' Agreement under Documents, and upload the signed copies.";
    case "Signed by investor": return "Thank you. RIV is countersigning.";
    case "Fully executed": return "RIV will send your payment instructions.";
    case "Funds due": return instruction ? `Pay USD ${outstanding.toLocaleString("en-US", { minimumFractionDigits: 2 })} by ${new Date(instruction.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} using your payment instructions under My investments.` : "RIV will send your payment instructions.";
    case "Funds received": return "Payment received. RIV is issuing your shares.";
    case "Shares issued":
    case "Active shareholder": return null;
    case "Soft commitment": return "Please confirm your soft commitment.";
    case "Soft commitment confirmed":
    case "Awaiting Fund launch": return "Thank you. RIV will contact you when the Fund launches.";
    case "NDA signed": return "RIV will give you data room access.";
    case "Diligence": return "Review the data room. Ask RIV any questions.";
    case "Term sheet": return "Agree final terms with the startup.";
    case "Definitive documents signed": return "Pay the startup directly as agreed, then upload your payment confirmation.";
    case "Funds transferred": return "Waiting for the startup to confirm your allotment.";
    default: return null;
  }
}

module.exports = {
  FLOWS, FLOW_FOR_VEHICLE, EXIT_STATUSES, nextStage, stageIndex, loadCommitment, checkEligibility, evidenceFor,
  readiness, advance, recheck, recordEvent, createCommitment, investorNextAction, INVESTOR_ACTIONS,
};
