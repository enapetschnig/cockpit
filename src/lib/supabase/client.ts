import { createBrowserClient } from "@supabase/ssr";

/** Supabase-Client für den Browser (Login/Logout). Nutzt die öffentlichen NEXT_PUBLIC-Variablen. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
