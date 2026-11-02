// Alerts bell in the top bar (PRD 8.13). The count refreshes every minute;
// the list loads when opened. Clicking an alert goes to the record.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "../api.js";
import { BRAND, FONT, MUTED } from "../brand.js";
import { LinkButton, dateTimeStr } from "./ui.jsx";

const POLL_MS = 60000;
const PANEL_WIDTH = 340;

export function NotificationBell({ onOpenLink }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const box = useRef(null);

  const refreshCount = useCallback(() => { api.unreadNotifications().then((r) => setUnread(r.unread)).catch(() => {}); }, []);
  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return undefined;
    api.notifications().then((r) => { setItems(r.notifications); setUnread(r.unread); }).catch(() => setItems([]));
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Placed from the button, because the top bar can wrap on narrow screens.
  function toggle() {
    const r = box.current.getBoundingClientRect();
    setPlace({ top: r.bottom + 6, left: Math.max(16, Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 16)) });
    setOpen((o) => !o);
  }

  async function pick(n) {
    setOpen(false);
    if (!n.read_at) {
      setUnread((u) => Math.max(0, u - 1));
      await api.readNotification(n.id).catch(() => {});
    }
    if (n.link_view) onOpenLink(n.link_view, n.link_id);
  }

  async function readAll() {
    await api.readAllNotifications().catch(() => {});
    setUnread(0);
    setItems((list) => (list || []).map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
  }

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"} onClick={toggle} style={{
        position: "relative", background: "none", border: `1px solid ${BRAND.line}`, borderRadius: 10, padding: 8, cursor: "pointer", display: "flex", color: "#7A756F",
      }}>
        <Bell size={16} />
        {unread > 0 && (
          <span style={{ position: "absolute", top: -6, right: -6, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 999, background: BRAND.coral, color: "#fff", fontFamily: FONT, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div style={{ position: "fixed", top: place.top, left: place.left, width: PANEL_WIDTH, maxWidth: "calc(100vw - 32px)", maxHeight: 420, overflowY: "auto", background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(39,37,37,0.14)", zIndex: 50, fontFamily: FONT }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${BRAND.line}` }}>
            <strong style={{ fontSize: 13 }}>Alerts</strong>
            {unread > 0 && <LinkButton onClick={readAll} style={{ fontSize: 12 }}>Mark all as read</LinkButton>}
          </div>
          {!items ? <div style={{ padding: 16, fontSize: 12.5, color: MUTED }}>Loading…</div>
            : !items.length ? <div style={{ padding: 16, fontSize: 12.5, color: MUTED }}>Nothing yet.</div>
            : items.map((n) => (
              <button key={n.id} type="button" onClick={() => pick(n)} style={{
                display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: `1px solid ${BRAND.line}`, padding: "10px 14px", cursor: "pointer", fontFamily: FONT,
                background: n.read_at ? "#fff" : BRAND.cream,
              }}>
                <div style={{ fontSize: 12.5, fontWeight: n.read_at ? 500 : 700, color: BRAND.ink, lineHeight: 1.45 }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 11.5, color: "#7A756F", marginTop: 2, lineHeight: 1.5 }}>{n.body}</div>}
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>{dateTimeStr(n.created_at)}</div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
