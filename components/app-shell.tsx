import Link from "next/link";
import { BarChart3, BookOpen, History, Settings, Shuffle } from "lucide-react";
import type { ReactNode } from "react";
import type { User } from "@/lib/types";

const navigation = [
  { href: "/", label: "Ziehen", icon: Shuffle },
  { href: "/bibliothek", label: "Bibliothek", icon: BookOpen },
  { href: "/verlauf", label: "Verlauf", icon: History },
  { href: "/statistik", label: "Statistik", icon: BarChart3 },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Hörspielbeutel – Startseite">
          <span className="brand-mark"><Shuffle size={20} /></span>
          <span><strong>Hörspielbeutel</strong><small>Ohne Zurücklegen</small></span>
        </Link>
        <nav className="sidebar-nav" aria-label="Hauptnavigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}><Icon size={18} /><span>{label}</span></Link>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
          <span><strong>{user.email}</strong><small>{user.role === "owner" ? "Eigentümer" : user.role}</small></span>
        </div>
      </aside>
      <main className="main-content">{children}</main>
      <nav className="mobile-nav" aria-label="Mobile Hauptnavigation">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}><Icon size={20} /><span>{label}</span></Link>
        ))}
      </nav>
    </div>
  );
}
