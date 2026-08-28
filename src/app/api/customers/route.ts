import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toCustomerDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    include: { todos: true, emails: true },
  });
  // Noch nicht gesehene App-Wünsche je Kunde – ein Aufruf statt N Zählabfragen.
  const offen = await prisma.appWunsch.groupBy({
    by: ["customerId"],
    where: { gesehenAm: null, customerId: { not: null } },
    _count: { _all: true },
  });
  const proKunde = new Map(offen.map((r) => [r.customerId as string, r._count._all]));
  return NextResponse.json(customers.map((c) => toCustomerDTO(c, proKunde.get(c.id) ?? 0)));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = (body?.name ?? "").toString().trim();
  if (!name) return NextResponse.json({ error: "name fehlt" }, { status: 400 });

  const c = await prisma.customer.create({
    data: { name, meta: body?.meta ?? null, color: body?.color ?? "#2f6df0" },
    include: { todos: true, emails: true },
  });
  return NextResponse.json(toCustomerDTO(c));
}
