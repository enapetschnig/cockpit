import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toEmailDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  const emails = await prisma.email.findMany({
    orderBy: { receivedAt: "desc" },
    include: { customer: true },
  });
  return NextResponse.json(emails.map(toEmailDTO));
}
