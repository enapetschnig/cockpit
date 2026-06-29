import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// GET /api/me -> Rolle + E-Mail des eingeloggten Users (für rollenabhängige UI)
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ role: null }, { status: 200 });
  return NextResponse.json({ role: user.role, email: user.email });
}
