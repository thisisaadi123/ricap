// RICap Portal: Retail Innovation Capital (PRD v1.1). Root component:
// signed-out screens (sign-in, invite, password reset) and the signed-in
// shell for each role. Views live in ./views; shared UI in ./components.
import React, { useEffect, useState } from "react";
import { api, clearSession, getStoredUser, setSessionExpiredHandler, setStoredUser } from "./api.js";
import { BRAND, FONT } from "./brand.js";
import { GlobalStyle, useDisableNumberInputScroll } from "./components/ui.jsx";
import { NavBar, navItemsFor } from "./components/NavBar.jsx";
import { LoginView } from "./views/auth/LoginView.jsx";
import { AcceptInviteView } from "./views/auth/AcceptInviteView.jsx";
import { ForgotPasswordView, ResetPasswordView } from "./views/auth/PasswordResetViews.jsx";
import { AdminOverview } from "./views/admin/AdminOverview.jsx";
import { AdminPartnersView } from "./views/admin/AdminPartnersView.jsx";
import { AdminInvestorsView } from "./views/admin/AdminInvestorsView.jsx";
import { AdminKycView } from "./views/admin/AdminKycView.jsx";
import { AdminVehiclesView } from "./views/admin/AdminVehiclesView.jsx";
import { AdminCommitmentsView } from "./views/admin/AdminCommitmentsView.jsx";
import { AdminDealsView } from "./views/admin/AdminDealsView.jsx";
import { AdminMoneyView } from "./views/admin/AdminMoneyView.jsx";
import { AdminUpdatesView } from "./views/admin/AdminUpdatesView.jsx";
import { PartnerUpdatesView } from "./views/partner/PartnerUpdatesView.jsx";
import { InvestorProfileView, InvestorStatementView, InvestorUpdatesView } from "./views/investor/InvestorUpdateViews.jsx";
import { AdminSettingsView } from "./views/admin/AdminSettingsView.jsx";
import { PartnerPayoutsView } from "./views/partner/PartnerPayoutsView.jsx";
import { PartnerDashboardView } from "./views/partner/PartnerDashboardView.jsx";
import { PartnerInvestorsView } from "./views/partner/PartnerInvestorsView.jsx";
import { PartnerCommitmentsView, PartnerOpportunitiesView } from "./views/partner/PartnerOpportunityViews.jsx";
import { InvestorInvestmentsView, InvestorOpportunitiesView } from "./views/investor/InvestorInvestmentViews.jsx";
import { InvestorDocumentsView, InvestorHome, InvestorKycView } from "./views/investor/InvestorViews.jsx";

// Signed-out screens reached by link (from invite / reset emails) or from
// the sign-in page.
function readAuthRoute() {
  const { pathname, search } = window.location;
  const token = new URLSearchParams(search).get("token") || "";
  if (pathname === "/accept-invite") return { screen: "invite", token };
  if (pathname === "/reset-password") return { screen: "reset", token };
  if (pathname === "/forgot-password") return { screen: "forgot" };
  return { screen: "login" };
}

function defaultViewFor(role) {
  return navItemsFor(role)[0].id;
}

export default function RicapApp() {
  const [user, setUser] = useState(() => getStoredUser());
  const [view, setView] = useState(() => (getStoredUser() ? defaultViewFor(getStoredUser().role) : null));
  const [authRoute, setAuthRoute] = useState(readAuthRoute);
  const [notice, setNotice] = useState("");
  // Admin KYC tab: which KYC file is open (null shows the queue).
  const [kycFileId, setKycFileId] = useState(null);
  // Admin Commitments tab: vehicle filter and the open commitment.
  const [commitmentVehicle, setCommitmentVehicle] = useState(null);
  const [commitmentId, setCommitmentId] = useState(null);
  const [dealId, setDealId] = useState(null);
  // Investor My investments tab: the open investment.
  const [investmentId, setInvestmentId] = useState(null);
  // Investor Updates tab: the update an alert pointed at.
  const [updateId, setUpdateId] = useState(null);
  useDisableNumberInputScroll();

  function goTo(screen, message = "") {
    const path = { login: "/", forgot: "/forgot-password" }[screen] || "/";
    window.history.replaceState(null, "", path);
    setAuthRoute({ screen });
    setNotice(message);
  }

  // The stored copy can go stale (a name change, say); the server has the truth.
  async function refreshUser() {
    const { user: fresh } = await api.me();
    setStoredUser(fresh);
    setUser(fresh);
  }

  function logout(message = "") {
    clearSession();
    setUser(null);
    setView(null);
    goTo("login", message);
  }

  useEffect(() => {
    setSessionExpiredHandler(() => logout("Your session has ended. Please sign in again."));
    // A stored session may have expired or the account may have been
    // suspended since the last visit; check with the server.
    if (getStoredUser()) refreshUser().catch(() => logout());
  }, []);

  const signedOutScreen = (() => {
    if (authRoute.screen === "invite") {
      return <AcceptInviteView token={authRoute.token} onDone={(msg) => goTo("login", msg)} onGoToLogin={() => goTo("login")} />;
    }
    if (authRoute.screen === "reset") {
      return <ResetPasswordView token={authRoute.token} onDone={(msg) => goTo("login", msg)} onGoToLogin={() => goTo("login")} />;
    }
    if (authRoute.screen === "forgot") return <ForgotPasswordView onGoToLogin={() => goTo("login")} />;
    if (!user) {
      return (
        <LoginView
          notice={notice}
          onForgot={() => goTo("forgot")}
          onAuthed={(u) => { setNotice(""); setUser(u); setView(defaultViewFor(u.role)); }}
        />
      );
    }
    return null;
  })();

  if (signedOutScreen) return <><GlobalStyle />{signedOutScreen}</>;

  const title = navItemsFor(user.role).find((it) => it.id === view)?.label;

  function changeView(v) {
    setView(v);
    setKycFileId(null);
    setCommitmentId(null);
    setDealId(null);
    setInvestmentId(null);
    setUpdateId(null);
  }

  // An alert was clicked: go to its page and open the record if the page can.
  function openLink(linkView, linkId) {
    changeView(linkView);
    if (!linkId) return;
    if (linkView === "kyc" && user.role === "admin") setKycFileId(linkId);
    if (linkView === "commitments" && user.role === "admin") setCommitmentId(linkId);
    if (linkView === "investments") setInvestmentId(linkId);
    if (linkView === "updates") setUpdateId(linkId);
  }

  return (
    <div style={{ minHeight: "100vh", background: BRAND.cream }}>
      <GlobalStyle />
      <NavBar view={view} setView={changeView} user={user} onLogout={() => logout()} onOpenLink={openLink} />
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "28px 24px 60px" }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: BRAND.ink, marginBottom: 18 }}>{title}</div>

        {user.role === "admin" && view === "overview" && <AdminOverview onNavigate={changeView} onOpenLink={openLink} />}
        {user.role === "admin" && view === "partners" && <AdminPartnersView />}
        {user.role === "admin" && view === "investors" && <AdminInvestorsView onOpenKyc={(id) => { setKycFileId(id); setView("kyc"); }} />}
        {user.role === "admin" && view === "kyc" && <AdminKycView openFileId={kycFileId} setOpenFileId={setKycFileId} />}
        {user.role === "admin" && view === "vehicles" && <AdminVehiclesView currentUser={user} onOpenCommitments={(id) => { setCommitmentVehicle(id); setCommitmentId(null); setView("commitments"); }} />}
        {user.role === "admin" && view === "deals" && <AdminDealsView openId={dealId} setOpenId={setDealId} onOpenCommitment={(id) => { setCommitmentId(id); setView("commitments"); }} />}
        {user.role === "admin" && view === "commitments" && <AdminCommitmentsView vehicleFilter={commitmentVehicle} setVehicleFilter={setCommitmentVehicle} openId={commitmentId} setOpenId={setCommitmentId} />}
        {user.role === "admin" && view === "money" && <AdminMoneyView currentUser={user} />}
        {user.role === "admin" && view === "updates" && <AdminUpdatesView />}
        {user.role === "admin" && view === "settings" && <AdminSettingsView currentUser={user} />}

        {user.role === "partner" && view === "dashboard" && <PartnerDashboardView onNavigate={changeView} />}
        {user.role === "partner" && view === "investors" && <PartnerInvestorsView />}
        {user.role === "partner" && view === "opportunities" && <PartnerOpportunitiesView />}
        {user.role === "partner" && view === "commitments" && <PartnerCommitmentsView />}
        {user.role === "partner" && view === "payouts" && <PartnerPayoutsView />}
        {user.role === "partner" && view === "updates" && <PartnerUpdatesView />}

        {user.role === "investor" && view === "home" && <InvestorHome user={user} onNavigate={changeView} onOpenInvestment={(id) => openLink("investments", id)} onOpenUpdate={(id) => openLink("updates", id)} />}
        {user.role === "investor" && view === "investments" && <InvestorInvestmentsView openId={investmentId} setOpenId={setInvestmentId} />}
        {user.role === "investor" && view === "opportunities" && <InvestorOpportunitiesView onOpenInvestment={(id) => { setInvestmentId(id); setView("investments"); }} />}
        {user.role === "investor" && view === "kyc" && <InvestorKycView />}
        {user.role === "investor" && view === "documents" && <InvestorDocumentsView />}
        {user.role === "investor" && view === "updates" && <InvestorUpdatesView openId={updateId} />}
        {user.role === "investor" && view === "statement" && <InvestorStatementView />}
        {user.role === "investor" && view === "profile" && <InvestorProfileView onSaved={() => refreshUser().catch(() => {})} />}
      </div>
    </div>
  );
}
