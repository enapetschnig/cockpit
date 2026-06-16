import { NextResponse } from "next/server";
import { reconcileMonth, reconcileAll } from "@/lib/abgleich";

export const dynamic = "force-dynamic";

/** Abgleich-Ansicht. ?month=YYYY-MM für einen Monat, ohne = alle Monate (neueste zuerst). */
export async function GET(req: Request) {
  const month = new URL(req.url).searchParams.get("month");
  const months = month ? [await reconcileMonth(month)] : await reconcileAll();
  return NextResponse.json({ months });
}
