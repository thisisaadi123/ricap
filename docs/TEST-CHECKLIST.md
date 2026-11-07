# RICap manual test checklist (M0–M7)

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
- [ ] 0.6 **Settings → Users → Invite admin**: name "Test Admin", your test email → green banner with a copyable invite link (email isn't set up).
- [ ] 0.7 Invite the same email again → "A user with this email already exists."
- [ ] 0.8 Open the invite link in a private window → "Welcome, Test Admin"; a short password (under 10 characters) is refused; mismatched passwords are refused; a good password → "Your password is set".
- [ ] 0.9 Open the same link again → "This invite link has expired or was already used."
- [ ] 0.10 Sign in as Test Admin (code from Terminal 2) → admin **Overview**.
- [ ] 0.11 As admin, **Suspend** Test Admin → in their window, any click sends them back to sign-in ("Your session has ended"). Signing in again → "This account is suspended." **Reactivate** → can sign in again.
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
- [ ] 2.3 Upload a PDF for one item → status Received. Try **Submit to RIV** → disabled ("6 required documents still needed"). Try uploading an .exe or a file over 4 MB → refused.
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

## M5 – Money and partner payouts

Use an investor brought by the demo partner, on the HoldCo. Emails and sign-in codes print in the backend terminal.

- [ ] 5.1 Partner proposes the investor for $100,000. Partner → **Payouts**: **Accruing** estimate $4,200 ($4,000 + 5% VAT).
- [ ] 5.2 Take it to Fully executed with a committed amount of $80,000. The estimate becomes $3,360.
- [ ] 5.3 Record a part receipt: still Accruing. Record the rest: Money → **Partner payouts → To approve** shows it. The partner gets an alert and an email.
- [ ] 5.4 Void the last receipt on the commitment: the payout goes back to Accruing. Record it again: back to To approve.
- [ ] 5.5 **Approve**, then **To pay → Record payment** with date, reference and proof. Partner sees **Paid** with that date and reference.
- [ ] 5.6 Try voiding a receipt on that commitment: refused, because the partner has been paid.
- [ ] 5.7 Money → **Money in and out**: receipts and the payout appear with proof, totals add up, filters work. **Reconcile** one; tick **Unreconciled only**: it's gone.
- [ ] 5.8 **Void** the partner payment with a reason: the movement stays greyed out and the payout returns to To pay.
- [ ] 5.9 Settings → **Payout rules**: set the threshold to $3,000. A larger payout needs a second, different admin (sign in as admin2). The first admin sees "A second admin must too". Set it back to $50,000.
- [ ] 5.10 IB deal: when a payout is more than the cash fee received, approving asks for a reason.
- [ ] 5.11 Fund commitment from a partner's investor: the payout stays Accruing.
- [ ] 5.12 Withdraw a commitment with an accruing payout: payout Cancelled. Reopen: back to Accruing.
- [ ] 5.13 Money → **RIV's investments**: **New investment** → **Approve** → **Record payment** with proof. Deployed total goes up and it appears in Money in and out. Try **Exited**, **Write off**, **Cancel** and **Documents**.
- [ ] 5.14 Partners → edit a partner: **VAT on payouts %** at 0 means no VAT on their new payouts.

## M6 – Updates, statements, alerts, profile

- [ ] 6.1 Investor's KYC opened or cleared: the bell shows a count; clicking the alert goes to the KYC page. **Mark all as read** clears the count.
- [ ] 6.2 Partner adds an investor: admin bell shows "New investor to review". Investor submits KYC: "KYC to review", and clicking opens that file.
- [ ] 6.3 Offer documents issued, payment instructions, soft commitment: investor gets an alert and an email (no bank details in either).
- [ ] 6.4 **Updates → New update**: choose the HoldCo, write a title and text, save. Add an attachment. Investors don't see it while it's a draft.
- [ ] 6.5 **Publish**: delivery log lists each investor with email status. An investor only at Eligible is not on it. Someone without a login shows "No portal login yet".
- [ ] 6.6 Investor → **Updates**: unread dot, open it, attachment opens. Admin's log now shows it as read. The Home page shows the latest update.
- [ ] 6.7 Partner → **Updates**: says it went out and to whom, without title, text or attachment. Publish another with **Partners can read this** ticked: partner can read it.
- [ ] 6.8 Publish to **Selected investors**: only they get it. Selecting nobody: publishing is refused.
- [ ] 6.9 **Withdraw** with a reason: it leaves the investor's and partner's pages, and the attachment no longer opens.
- [ ] 6.10 Investor → **Statement**: committed, paid, outstanding and each payment. Choose an earlier date: later payments drop out. **Print or save as PDF** prints only the statement.
- [ ] 6.11 Admin → Investors → an investor → **Statement and updates**: same statement and the list of updates sent.
- [ ] 6.12 Investor → **Profile**: change phone: saved, KYC unchanged. Change legal name: warning appears; saved; KYC page says what's needed; admin gets an alert that opens the file; the audit log shows old and new names.

## M7 – Dashboards

Run M5 first so there are figures to see. After each change, reload and check the number moved.

- [ ] 7.1 Admin → **Overview → Home**: headline shows investors, live IB deals and current commitments. HoldCo target $2M and Fund target $50M, with committed, received and outstanding.
- [ ] 7.2 Partner adds an investor: **Registrations to review** goes up; clicking it opens Investors.
- [ ] 7.3 **Pipeline by stage**: move a commitment forward and its count moves to the next stage.
- [ ] 7.4 Record a part receipt: received goes up and outstanding goes down. Void it: both go back.
- [ ] 7.5 **Stuck commitments**: set the box to 0, then 14. Only commitments with no stage change for more than that many days appear; a note doesn't reset it. A fresh commitment takes a day to appear at 0. Clicking a row opens the commitment.
- [ ] 7.6 **Overdue payments**: issue instructions with a due date, then check after it passes (or use an older demo record). Paying in full removes it.
- [ ] 7.7 **Fees, payouts and RIV's investments** match the Money page and the deal's invoices.
- [ ] 7.8 **Partner leaderboard**: registered, committed, sourced and conversion make sense for the demo partner.
- [ ] 7.9 **Compliance**: upload all documents for a commitment's next stage and it appears under **Stages waiting for sign-off**; advance it and it goes. KYC files show status, age and risk, and clicking opens the file.
- [ ] 7.10 Change a legal name in an investor's Profile after their commitment is past Eligible: they appear under **Past Eligible without cleared KYC**.
- [ ] 7.11 Audit trail: search for a person, an action or a payment reference. Typing `%` finds only entries containing `%`.
- [ ] 7.12 An admin without restricted access sees "needs restricted access" instead of KYC figures.
- [ ] 7.13 **Money position**: expected payments by due date, unreconciled money, invoices and payouts due. Reconcile something on the Money page and it leaves the list.
- [ ] 7.14 Partner lands on **Dashboard**: investors, committed, received, payouts, their commitments, and open vehicles with teasers. They see only their own investors.
- [ ] 7.15 Investor **Home**: **Actions needed** lists KYC, documents to sign, soft commitments and payments due, and each opens the right page. **My holdings** shows committed, paid and outstanding; Fund shows as soft commitment. With nothing to do, it says so.

## M10 – Venture partner referrals

- [ ] M10.1 Partner → My investors → Introduce an investor. Required: name, category, an investment figure (from or up to), Source, why you're referring, contact name and email, and the consent box. LinkedIn, country and the Yes/No questions are optional. Without the consent box it won't submit.
- [ ] M10.2 The partner's investor list shows simple statuses: Submitted, Accepted, In progress, Invested, Not accepted. No duplicate information is ever shown.
- [ ] M10.3 Partner → My startups → Introduce startup. Required: name, website, founder name and email, description, why you're referring, permission box. "acme.com" is accepted as a website.
- [ ] M10.4 Admin → Startups: the new startup is in To review and admins got an alert. A startup with the same website, name or founder email as another shows "possible duplicate"; the partner can't see that.
- [ ] M10.5 Review: Mark under review, Accept (partner is credited for their credit window), Reject (reason needed, shown to the partner), Mark as duplicate of (partner just sees "Not accepted").
- [ ] M10.6 An accepted startup: Create deal draft. Enter instrument, round size and pre-money; a round under USD 500K needs a reason. A draft IB deal appears under IB deals with the startup and partner filled in.
- [ ] M10.7 Once the deal exists the partner's startup status follows it: Accepted, then Live, then Closed.
- [ ] M10.8 Partner Dashboard shows investors and startups introduced with a count per status. No dollar amounts anywhere on it, and there is no Payouts tab for partners.
- [ ] M10.9 Admin Overview "Registrations to review" counts investors and startups together.

## Bug-fix checks

- [ ] B.1 Withdraw or hold a commitment at Funds due: the investor no longer sees the bank details. Resume it: they come back.
- [ ] B.2 Vehicles → change the receiving account (two admins) with a commitment at Funds due: admins get an alert, Money position says "Old bank account: reissue", and the commitment asks you to void and reissue.
- [ ] B.3 IB investor who has paid the startup: Home shows nothing outstanding.
- [ ] B.4 On an oversubscribed IB deal, partner payouts never add up to more than 100% of the sweat value.
- [ ] B.5 Mark a partner's investor as a duplicate: the partner's alert just says "not accepted".
- [ ] B.6 Add "Acme LLC." then "Acme LLC", or the same Arabic name twice: the duplicate warning appears.
- [ ] B.7 Settings → Users only invites admins. Partners and investors are invited from their own records.
- [ ] B.8 Reset a password while signed in elsewhere: the other session is signed out.
- [ ] B.9 An On hold commitment: choose Dropped and Apply. It works.
- [ ] B.10 Commitment → Documents: change **Visible to**. The investor's Documents page follows it. Executed agreements, NDAs and term sheets are shared with the investor by default.
- [ ] B.11 Upload a file with an Arabic name: the name stays right when downloaded. A file over 4 MB is refused with a clear message.
- [ ] B.12 Investor changes their name in Profile: the top bar updates straight away.

## Not built yet (don't test)

Retail intelligence, including the retail parts of the dashboards (M8). Zoho Sign is tracked by hand; emails go to Terminal 2 until Resend is configured; files are stored in `backend/storage` until Supabase Storage is configured.
