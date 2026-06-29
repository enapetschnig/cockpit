import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ePower Cockpit",
    short_name: "ePower",
    description: "Kontrollhub der ePower GmbH – Werbeanzeigen, Leads/CRM & E-Mail-Cockpit",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf9f6",
    theme_color: "#faf9f6",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
