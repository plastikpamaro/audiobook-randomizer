import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Hörspielbeutel",
  title: { default: "Hörspielbeutel", template: "%s · Hörspielbeutel" },
  description: "Dein persönlicher Hörspiel-Zufallsgenerator ohne Zurücklegen.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Hörspielbeutel" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "Hörspielbeutel",
    title: "Hörspielbeutel",
    description: "Zufällig hören, nichts doppelt erwischen.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0c0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
