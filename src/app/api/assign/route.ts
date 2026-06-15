import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toEmailDTO } from "@/lib/serialize";

/**
 * Ordnet eine Mail zu. Varianten im Body:
 *  - { emailId, fileBuch: true }           -> in Buchhaltung ablegen
 *  - { emailId, customerId }               -> bestehendem Kunden zuordnen
 *  - { emailId, newCustomerName }          -> neuen Kunden anlegen + zuordnen
 *  - optional: { todos: string[] }         -> Aufgaben beim Kunden anlegen
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const emailId = body?.emailId as string | undefined;
  if (!emailId) return NextResponse.json({ error: "emailId fehlt" }, { status: 400 });

  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return NextResponse.json({ error: "Mail nicht gefunden" }, { status: 404 });

  // In Buchhaltung ablegen
  if (body.fileBuch) {
    const updated = await prisma.email.update({
      where: { id: emailId },
      data: { filed: true },
      include: { customer: true },
    });
    return NextResponse.json(toEmailDTO(updated));
  }

  // Kunde bestimmen (ggf. neu anlegen)
  let customerId = body.customerId as string | undefined;
  if (!customerId && body.newCustomerName) {
    const created = await prisma.customer.create({
      data: { name: String(body.newCustomerName).trim(), color: "#2f6df0" },
    });
    customerId = created.id;
  }
  if (!customerId) return NextResponse.json({ error: "customerId oder newCustomerName fehlt" }, { status: 400 });

  const updated = await prisma.email.update({
    where: { id: emailId },
    data: { customerId },
    include: { customer: true },
  });

  // Optional: vorgeschlagene Aufgaben beim Kunden anlegen
  if (Array.isArray(body.todos)) {
    for (const t of body.todos) {
      const text = String(t).trim();
      if (text) await prisma.todo.create({ data: { text, customerId, emailId } });
    }
  }

  return NextResponse.json(toEmailDTO(updated));
}
