import { NextResponse } from "next/server";
import { listAccounts, isGmailConfigured } from "@/lib/gmail";

export const dynamic = "force-dynamic";

// Status für die Verbinden-Seite: ist Gmail konfiguriert? welche Postfächer sind verbunden?
export async function GET() {
  try {
    return NextResponse.json({ configured: await isGmailConfigured(), accounts: await listAccounts() });
  } catch (e) {
    // z. B. wenn die DB-Verbindung (noch) fehlt
    return NextResponse.json({ configured: false, accounts: [], error: (e as Error).message }, { status: 200 });
  }
}
