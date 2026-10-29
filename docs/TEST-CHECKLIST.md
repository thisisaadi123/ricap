# RICap manual test checklist (M0–M4)

Work through each section in order: later sections reuse what earlier ones create. Tick each box as you go. Every step says what you should see; if you see something else, note the step number.

## 0. Setup (once)

1. Create `backend/.env` (if it doesn't exist) with:
   ```
   DATABASE_URL=postgresql://ricap:ricap-local@localhost:54329/ricap
   PGSSL=false
   JWT_SECRET=any-long-random-string-for-local-testing
   APP_URL=http://localhost:5190
   ```
2. Terminal 1: `cd backend && npm install && npm run db:local` (leave it running).
3. Terminal 2: `cd backend && npm run seed && npm run dev` (leave it running; **sign-in codes and invite links appear here**).
4. Terminal 3: `cd frontend && npm install && npm run dev`, then open http://localhost:5190.

Demo logins (each needs the 6-digit code from Terminal 2):

| Role | Email | Password |
|---|---|---|
| Admin (restricted access) | admin@ricap.demo | admin-demo-123 |
| Second admin | admin2@ricap.demo | admin2-demo-123 |
| Venture partner | partner@ricap.demo | partner-demo-123 |
| Investor (Demo Family Office LLC) | investor@ricap.demo | investor-demo-123 |

To start over with an empty database: stop Terminal 1, delete `backend/.localdb`, start it again and re-run `npm run seed`.

Tip: use a private window for a second role at the same time.

---

## M0 – Sign-in, invites, users, audit

- [ ] 0.1 Sign in as admin with a **wrong password** → "Incorrect email or password."
- [ ] 0.2 Sign in with the right password → code screen showing a masked email (ad•••@ricap.demo).
- [ ] 0.3 Enter a **wrong code** → "That code isn't right. 4 tries left."
- [ ] 0.4 Click **Send a new code** straight away → asked to wait 30 seconds. After 30s → new code in Terminal 2; the old one no longer works.
- [ ] 0.5 Enter the right code → admin **Overview**.
- [ ] 0.6 **Settings → Users → Invite user**: name "Test Partner", your test email, role Venture Partner → green banner with a copyable invite link (email isn't set up).
- [ ] 0.7 Invite the same email again → "A user with this email already exists."
- [ ] 0.8 Open the invite link in a private window → "Welcome, Test Partner"; a short password (under 10 characters) is refused; mismatched passwords are refused; a good password → "Your password is set".
- [ ] 0.9 Open the same link again → "This invite link has expired or was already used."
- [ ] 0.10 Sign in as Test Partner (code from Terminal 2) → partner screens ("My investors").
- [ ] 0.11 As admin, **Suspend** Test Partner → in the partner's window, any click sends them back to sign-in ("Your session has ended"). Signing in again → "This account is suspended." **Reactivate** → can sign in again.
- [ ] 0.12 Admin can't suspend themselves (no Suspend button on your own row).
- [ ] 0.13 Sign-in page → **Forgot your password?** for investor@ricap.demo → same message whether or not the email exists; reset link in Terminal 2 → set a new password → sign in with it. (Use the new password from now on.)
- [ ] 0.14 **Settings → Audit log** shows sign-ins, the failed attempts, invite, suspension and reset.

## M1 – Partners, investors, Bigin import

**Partners (admin → Partners)**
- [ ] 1.1 **Add partner** with name and email only → stage New, terms default to 4% HoldCo, 4% Fund, 15% IB, 12-month credit window.
- [ ] 1.2 Open it → **Send login invite** is disabled until Onboarded. Set stage **Onboarded** without a signed date → error asking for the date. Add the date → saved.
- [ ] 1.3 **Send login invite** → link shown; accept it in a private window; the partner can sign in.
- [ ] 1.4 Change the IB payout to 12.5 and save → shown on the partner's "My investors" page under "Your terms".
- [ ] 1.5 Partner record → **Documents** tab → upload a PDF as "Venture Partner Agreement" → listed; change its signature status; upload a **New version** (v2); **Void** it with a reason (stays visible under "Show voided").

**Investor registration**
- [ ] 1.6 As the demo partner, **Register investor**: Entity, "Gulf Ventures LLC", Family office, ticket 100,000–500,000, interested in HoldCo + Fund, contact with an email at a company domain (e.g. cfo@gulfventures.ae) → "Waiting for RIV".
- [ ] 1.7 Ticket "from" bigger than "up to" → refused.
- [ ] 1.8 As the second partner (Test Partner from 0.10), register "GULF VENTURES, LLC" with another @gulfventures.ae email.
- [ ] 1.9 Admin → **Investors → To review** → open the second one → **Possible duplicates** lists Gulf Ventures LLC with "Same name or company" and "Same email domain". The partner never sees this.
- [ ] 1.10 **Reject** without a reason → refused. **Mark as duplicate of** Gulf Ventures LLC → status Duplicate; the second partner sees "Not accepted" with no details.
- [ ] 1.11 Open the first Gulf Ventures → **Approve** → "Partner credit until" is 12 months from today.
- [ ] 1.12 **Add investor** (RIV direct) named "Gulf Ventures" → a duplicate warning first; **It's a different investor, add anyway** → created as Approved.
- [ ] 1.13 As admin, set net worth and inclination on an investor → saved. Then, as admin, **Settings → Users** → untick **Restricted access** for Second Admin. Sign in as admin2: that investor's net worth is hidden, and the KYC page says restricted access is needed. As admin, tick it again afterwards.
- [ ] 1.14 Investor **Contacts**: add a second contact, make them primary, remove the old one (allowed only if it has no login). **Invite to portal** works only for approved investors.

**Bigin import (Settings → Bigin import)**
- [ ] 1.15 Make a small CSV with headers like `Record Id,First Name,Last Name,Account Name,Email,Investor Type,Ticket Size` and 3–4 rows (one with a comma inside quotes, one duplicate of an existing investor, one with a bad email) → preview shows Will import / Skip / Problem per row and which columns were recognised.
- [ ] 1.16 **Import** → the new investors appear as Approved, source "Bigin import". Import the same file again → nothing new imported.
- [ ] 1.17 Same for "Prospective venture partners" → partners appear at stage New.

## M2 – KYC and documents

- [ ] 2.1 Admin → Investors → Gulf Ventures LLC → **KYC tab → Open KYC checklist** → you land on the KYC file with 7 entity items. Terminal 2 shows an email to any contact with a login.
- [ ] 2.2 Invite Gulf's contact to the portal (Contacts tab), accept the invite, sign in as them → **KYC** page lists the 7 items as "Needed".
- [ ] 2.3 Upload a PDF for one item → status Received. Try **Submit to RIV** → disabled ("6 required documents still needed"). Try uploading an .exe or a file over 10 MB → refused.
- [ ] 2.4 Upload the rest → **Submit to RIV** → "RIV is reviewing". Uploads are now paused.
- [ ] 2.5 Admin → **KYC → Waiting for review** → open Gulf → **Record decision: Cleared** → refused with a list (verify items, PEP, sanctions, risk, classification, beneficial owner).
- [ ] 2.6 **Reject** one item without a note → refused; with a note → "Sent back". Decision **Information requested** with a note.
- [ ] 2.7 As the investor: the note from RIV and "Please re-upload: …" on that item. Re-upload and resubmit.
- [ ] 2.8 As admin: **Upload** a file on an item as "received by email"; **Verify** every item; fill screening (Not a PEP, No match, date, Low risk, Professional client); add a beneficial owner; **Cleared** → refresh date one year ahead.
- [ ] 2.9 A cleared file can't be edited. Investors list shows KYC "Cleared"; the partner sees "Cleared" for their investor (no documents).
- [ ] 2.10 Click a KYC document link → it opens/downloads; **Settings → Audit log** shows "document.viewed".
- [ ] 2.11 As the partner, or as another investor, a KYC document can't be opened (no link shown; direct link → not found).
- [ ] 2.12 Investor → **Documents** tab (admin): upload an NDA shared with the investor and an internal memo → the investor's **Documents** page shows only the NDA.
- [ ] 2.13 **Settings → KYC & agreement templates**: add a checklist item; switch one off; upload an agreement template (Draft) → **Make active**; upload a second version of the same name and activate it → the first becomes Retired.
- [ ] 2.14 On the KYC file, **Open KYC refresh** (from the investor's KYC tab) → a new file; the old one is listed under "Earlier KYC files".

## M3 – Vehicles, commitments, HoldCo and Fund

**Vehicles (admin → Vehicles)**
- [ ] 3.1 Two cards: Retail X HoldCo raise ($2M target, $8M pre-money, min $25K) and Retail X Fund I ($50M, min $100K / $500K).
- [ ] 3.2 Fund → **Manage → Receiving account** → propose an account with a bad IBAN → refused. Propose a valid one (e.g. AE07 0331 2345 6789 0123 456, SWIFT EBILAEAD) → "waiting for a second admin"; you can't approve your own. Sign in as admin2 → **Approve** → account in use; history shows both admins.
- [ ] 3.3 **Visibility** tab → hide the Fund from Demo Family Office → the demo investor's **Opportunities** no longer shows it. **Show again**.
- [ ] 3.4 HoldCo → **Teaser & documents** → upload a PDF of type **Teaser** → the investor and partner see it under Opportunities and can open it.

**HoldCo flow**
- [ ] 3.5 As the demo investor → **Opportunities → I'm interested** in HoldCo, $50,000 → **My investments** shows it at Intent: "Complete your KYC…" (their KYC isn't cleared yet).
- [ ] 3.6 Trying again on the same opportunity shows "You're already in".
- [ ] 3.7 As admin, clear the demo investor's KYC (as in M2) → the commitment moves to **Eligible** automatically.
- [ ] 3.8 Admin → **Commitments** → open it → **Next: Offer documents issued** lists Term sheet, SSA, SHA. **Move** without them → error listing what's missing. Upload all three → Move.
- [ ] 3.9 Investor → the investment shows the 3 documents and "Sign the Subscription Agreement…". **Upload a signed document**.
- [ ] 3.10 Admin → "From the investor" section → tag the upload as **Subscription Agreement (SSA)**, evidence for **Signed by investor** → **Use as evidence**; upload the signed SHA → **Move to Signed by investor**.
- [ ] 3.11 Upload fully executed SSA and SHA → committed amount **10,000** → refused (below the $25K minimum). Use **60,000** → Fully executed.
- [ ] 3.12 **Issue** payment instructions with a due date → stage Funds due. The investor sees the bank details, reference and "Pay USD 60,000.00 by …", plus the warning about bank details by email.
- [ ] 3.13 Investor uploads a payment confirmation → stage stays Funds due.
- [ ] 3.14 Admin records a receipt of **100,000** → refused (more than outstanding). Record **20,000** with bank proof → outstanding $40,000. Record **40,000** → moves to **Funds received** by itself.
- [ ] 3.15 **Void** the last receipt with a reason → back to Funds due; record it again → Funds received.
- [ ] 3.16 Shares issued → upload board resolution, register extract, share certificate (shared with investor); enter 6,000 shares and certificate no. → Shares issued → Active shareholder. Receipts can no longer be voided.
- [ ] 3.17 Investor sees all stages done, payments received, the share certificate; bank proofs aren't visible to them.
- [ ] 3.18 **History & notes** tab shows every stage change; add a note.
- [ ] 3.19 **Vehicles** card: HoldCo committed $60K, received $60K. **Overview** capital bars match.

**Fund soft commitments & partner proposals**
- [ ] 3.20 As the demo partner → **Opportunities → Propose an investor** for the Fund: Gulf Ventures LLC, $200,000 → appears under the partner's **Commitments**.
- [ ] 3.21 Admin → the commitment waits at Intent: eligibility shows the $500K entity minimum failing. **Override minimum…** with a reason → Eligible. Credited to the partner.
- [ ] 3.22 Move to Soft commitment → "Next: investor confirms". **Upload emailed confirmation** → Soft commitment confirmed → Move to Awaiting Fund launch.
- [ ] 3.23 Demo investor → I'm interested in the Fund, $600,000 → (KYC cleared) Eligible. Admin moves it to Soft commitment → investor sees **Confirm soft commitment** → confirm → "Thank you".
- [ ] 3.24 Admin: put a commitment **On hold** (reason) → can't move. **Resume**. Mark **Dropped** → the investor can express interest in that vehicle again; **Reopen** the dropped one → refused while the new one is live.
- [ ] 3.25 **Settings → Stage evidence**: untick a HoldCo item → it's no longer required; tick it back.
- [ ] 3.26 Set the HoldCo vehicle to **Closed** → it disappears from Opportunities, and new commitments are refused. Set it back to Open.

## M4 – IB deals

- [ ] 4.1 Admin → **IB deals → New IB deal**: startup "ShelfSense", round **1,500,000**, pre-money 12,000,000 → the form warns and **Create** is refused (needs sweat equity under $2M). Change round to **3,000,000** → created as **Sourced**, fee 5%.
- [ ] 4.2 Create "Tiny Retail", SAFE, round 1,000,000, pre-money 8,000,000, sweat **1%** → sweat equity value shows **$80,000**.
- [ ] 4.3 Create a round of **300,000** with sweat 2% → asked for a reason for going below the $500K floor; add one → created.
- [ ] 4.4 ShelfSense → **Move to Mandate signed** without the engagement letter or date → refused. Upload the engagement letter, enter the date → Mandate signed.
- [ ] 4.5 **Move to Live** → refused (teaser and summary). **Deal details**: add the teaser summary and a data-room link (an http:// link is refused; use https://). Upload the teaser → **Live**.
- [ ] 4.6 Investor and partner Opportunities show ShelfSense with the teaser; the engagement letter is never visible to them. Tiny Retail (not live) doesn't appear.
- [ ] 4.7 Demo investor → **I'm interested**, $250,000 → Eligible (no investor minimum); "RIV will send you the NDA".
- [ ] 4.8 Admin → commitment → **Grant access** is refused before the NDA. Upload the signed NDA → NDA signed → **Grant access** → the investor now sees **Open the data room**. Move to Diligence; log a question in **History & notes**.
- [ ] 4.9 Term sheet → Definitive documents signed (investment agreement + committed $250,000) → the investor is told to pay the startup directly. There's no RIV payment-instructions option for IB.
- [ ] 4.10 **Funds transferred**: upload the startup's confirmation; without amount/date → refused; with $250,000 and a date → done.
- [ ] 4.11 Partner proposes their investor for ShelfSense and you take them to Funds transferred for $100,000 the same way.
- [ ] 4.12 Deal → **Fee invoices**: "2 confirmed placements not yet invoiced: $350,000". A due date in the past → refused. Create → **RXH-INV-YYYY-0001**: fee $17,500 + VAT $875 = **$18,375**, billed to ShelfSense, from Retail X HoldCo.
- [ ] 4.13 **Create invoice** again → nothing left to bill. **Record payment** before **Mark sent** isn't offered; mark sent; pay **17,500** → refused (must match the total); pay **18,375** with bank proof → Paid. A paid invoice can't be voided.
- [ ] 4.14 Take a third investor to Funds transferred ($75,000) → invoice 2 ($3,937.50) → **Void** it → invoice again → a new invoice for the same $75,000.
- [ ] 4.15 Upload the allotment confirmation on the demo investor's commitment → **Closed**.
- [ ] 4.16 Add one more investor who only reaches Eligible. **Close deal** with a reason → only that investor is withdrawn (with the reason); funded investors stay active. The deal disappears from Opportunities; the investor no longer sees the data-room link; deal details can't be edited.
- [ ] 4.17 Deal header: capital placed, cash fee, sweat equity value and RIV total consideration add up; **Data-room log** shows every grant.
- [ ] 4.18 The partner's **Commitments** shows their investor's IB commitment (stage and amounts only).

## Not built yet (don't test)

Partner payouts and outbound investments (M5), investor monthly letters and statements and in-app notifications (M6), full dashboards (M7), retail intelligence (M8). Zoho Sign is tracked by hand; emails go to Terminal 2 until Resend is configured; files are stored in `backend/storage` until Supabase Storage is configured.
