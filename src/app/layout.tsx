import type { Metadata, Viewport } from "next";
import "./globals.css";
import AddToHomeScreen from "@/components/AddToHomeScreen";

export const metadata: Metadata = {
  title: "ePower Cockpit",
  description: "Kontrollhub der ePower GmbH – Werbeanzeigen, Leads/CRM & E-Mail-Cockpit",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ePower", statusBarStyle: "default" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#faf9f6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        {children}
        <AddToHomeScreen />
      </body>
    </html>
  );
}
