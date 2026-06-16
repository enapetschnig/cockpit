import { NextResponse } from "next/server";
import { listEvents, createEvent, deleteEvent, type Account } from "@/lib/calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET ?days=14 -> Termine beider Kalender (chronologisch)
export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get("days") || "14");
  const [firma, privat] = await Promise.all([
    listEvents("firma", { days }).catch(() => []),
    listEvents("privat", { days }).catch(() => []),
  ]);
  const events = [...firma.map((e) => ({ ...e, account: "firma" })), ...privat.map((e) => ({ ...e, account: "privat" }))].sort((a, b) =>
    a.start < b.start ? -1 : 1
  );
  return NextResponse.json({ events });
}

// POST { account, title, start, end, location? } -> Termin anlegen
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { account?: string; title?: string; start?: string; end?: string; location?: string };
  if (!b.title || !b.start || !b.end) return NextResponse.json({ error: "title, start, end nötig" }, { status: 400 });
  const account: Account = b.account === "privat" ? "privat" : "firma";
  const ev = await createEvent(account, { title: b.title, start: b.start, end: b.end, location: b.location });
  return NextResponse.json({ ok: true, event: ev });
}

// DELETE ?account=&id= -> Termin löschen
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const account: Account = url.searchParams.get("account") === "privat" ? "privat" : "firma";
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id nötig" }, { status: 400 });
  await deleteEvent(account, id);
  return NextResponse.json({ ok: true });
}
