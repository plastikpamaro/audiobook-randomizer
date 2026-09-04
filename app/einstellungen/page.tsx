import { AppShell } from "@/components/app-shell";
import { SettingsClient } from "@/components/settings-client";
import { requirePageUser } from "@/lib/auth";
import { getAppTimezone } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser();
  return <AppShell user={user}><div className="page"><header className="page-header"><div><p className="eyebrow">Dein Zugang</p><h1>Einstellungen</h1><p className="muted">Account, Geräte und die wenigen Dinge, die sicher bleiben müssen.</p></div></header><SettingsClient user={user} timezone={getAppTimezone()} /></div></AppShell>;
}
