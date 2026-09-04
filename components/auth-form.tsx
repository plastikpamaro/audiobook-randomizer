"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Headphones, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthForm({ mode }: { mode: "login" | "setup" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      ...(mode === "setup" ? { setupToken: String(form.get("setupToken") || "") } : {}),
    };
    try {
      const response = await fetch(`/api/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Anmeldung fehlgeschlagen.");
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Anmeldung fehlgeschlagen.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-icon"><Headphones size={30} /></div>
        <p className="eyebrow">Hörspielbeutel</p>
        <h1>{mode === "setup" ? "Deinen Beutel einrichten" : "Willkommen zurück"}</h1>
        <p className="muted">
          {mode === "setup"
            ? "Lege den einzigen Eigentümer-Account an. Der Setup-Zugang schließt sich danach automatisch."
            : "Dein Hörfortschritt wartet auf jedem Gerät genau dort, wo du aufgehört hast."}
        </p>
        <form onSubmit={submit} className="stack auth-form">
          <label>E-Mail<input name="email" type="email" autoComplete="email" required /></label>
          <label>Passwort<input name="password" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} minLength={mode === "setup" ? 12 : 1} required /></label>
          {mode === "setup" && (
            <label>Einmaliger Setup-Schlüssel<input name="setupToken" type="password" autoComplete="off" required /></label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={19} /> : <ArrowRight size={19} />}
            {mode === "setup" ? "Account anlegen" : "Anmelden"}
          </Button>
        </form>
      </section>
    </main>
  );
}
