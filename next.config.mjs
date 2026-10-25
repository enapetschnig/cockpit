// Sicherheits-Header für alle Seiten und APIs. Die CSP sperrt bewusst NUR Einbetten (Clickjacking)
// und <base> – keine script-/connect-/object-Regeln (Supabase, Meta-Vorschaubilder, PDF-Ansicht in Safari …).
// Kamera/Mikrofon/Standort nutzt das Cockpit nicht (Sprachnachrichten laufen über Telegram).
const SICHERHEITS_HEADER = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // googleapis (+ Transitiv-Deps wie node-domexception) nicht bundeln, sondern
  // zur Laufzeit per require laden – verhindert "Can't resolve 'worker_threads'".
  serverExternalPackages: ["googleapis"],
  async headers() {
    return [{ source: "/:path*", headers: SICHERHEITS_HEADER }];
  },
};

export default nextConfig;
