import { WifiOff } from "lucide-react";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="auth-page">
      <section className="auth-card center">
        <div className="auth-icon"><WifiOff size={30} /></div>
        <p className="eyebrow">Gerade offline</p>
        <h1>Der Beutel braucht den Server.</h1>
        <p className="muted">Damit auf zwei Geräten nie doppelt gezogen wird, sind Ziehungen nur mit Verbindung möglich.</p>
        <Link className="button button-primary button-md" href="/">Erneut versuchen</Link>
      </section>
    </main>
  );
}
