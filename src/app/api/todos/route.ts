import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Aufgabe anlegen
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const text = (body?.text ?? "").toString().trim();
  if (!text) return NextResponse.json({ error: "text fehlt" }, { status: 400 });

  const todo = await prisma.todo.create({
    data: { text, customerId: body.customerId ?? null, emailId: body.emailId ?? null },
  });
  return NextResponse.json(todo);
}

// Aufgabe abhaken / wieder öffnen
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body?.id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });

  const todo = await prisma.todo.update({
    where: { id: body.id },
    data: { done: !!body.done },
  });
  return NextResponse.json(todo);
}
