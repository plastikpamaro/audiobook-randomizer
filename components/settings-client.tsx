"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clientApi } from "@/components/client-api";
import type { User } from "@/lib/types";

export function SettingsClient({ user, timezone }: { user: User; timezone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    if (newPassword !== String(form.get("repeatPassword") || "")) {
      setError("Die neuen Passwörter stimmen nicht überein."); setBusy(false); return;
    }
    try {
      await clientApi("/api/settings/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword }),
      });
      setMessage("Passwort geändert. Bitte melde dich erneut an.");
      window.setTimeout(() => { router.replace("/login"); router.refresh(); }, 900);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Passwort konnte nicht geändert werden."); setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try { await clientApi("/api/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Abmeldung fehlgeschlagen."); setBusy(false); }
  }

  return (
    <div className="settings-grid">
      <div className="stack">
        <Card><p className="eyebrow">Account</p><div className="settings-profile"><span className="settings-avatar">{user.email[0].toUpperCase()}</span><div><h2>{user.email}</h2><p className="muted">Rolle: {user.role === "owner" ? "Eigentümer" : user.role}</p></div></div><div className="settings-fact"><ShieldCheck size={18} /><span><strong>Serverseitiger Fortschritt</strong><small>Ziehungen, Verlauf und Notizen liegen in PostgreSQL – nicht in diesem Browser.</small></span></div><div className="settings-fact"><Smartphone size={18} /><span><strong>Auf dem Startbildschirm</strong><small>Öffne das Browsermenü und wähle „Zum Startbildschirm hinzufügen“.</small></span></div><div className="settings-fact"><KeyRound size={18} /><span><strong>Kalendertag</strong><small>Neuerscheinungen richten sich nach {timezone}.</small></span></div></Card>
        <Button variant="danger" onClick={logout} disabled={busy}><LogOut size={18} />Auf diesem Gerät abmelden</Button>
      </div>
      <Card><p className="eyebrow">Sicherheit</p><h2>Passwort ändern</h2><p className="muted">Dabei werden alle bestehenden Sitzungen beendet. Anschließend meldest du dich auf jedem Gerät neu an.</p><form className="stack settings-form" onSubmit={changePassword}><label>Aktuelles Passwort<input name="currentPassword" type="password" autoComplete="current-password" required /></label><label>Neues Passwort<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></label><label>Neues Passwort wiederholen<input name="repeatPassword" type="password" autoComplete="new-password" minLength={12} required /></label>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}<Button type="submit" disabled={busy}>{busy ? "Ändert…" : "Passwort ändern"}</Button></form></Card>
    </div>
  );
}
