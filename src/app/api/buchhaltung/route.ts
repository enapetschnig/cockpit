import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toBelegDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

/** Liste der Belege (neueste zuerst). Filter: ?status= ?month= ?kind= */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const month = searchParams.get("month") || undefined;
  const kind = searchParams.get("kind") || undefined;

  const belege = await prisma.beleg.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(month ? { periodMonth: month } : {}),
      ...(kind ? { kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ belege: belege.map(toBelegDTO) });
}
