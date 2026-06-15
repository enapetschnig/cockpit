import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toCustomerDTO } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    include: { todos: true, emails: true },
  });
  return NextResponse.json(customers.map(toCustomerDTO));
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
