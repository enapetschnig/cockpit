import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadBeleg } from "@/lib/supabase/server";
import { parseStatement } from "@/lib/statementParse";
import { autoMatchPeriod, monthOf } from "@/lib/abgleich";
import { toBelegDTO } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manueller Upload eines Kontoauszugs / einer Kreditkartenabrechnung (PDF oder CSV).
 * Speichert die Datei, legt einen Beleg(kind) an (geht in dieselbe BMD-Upload-Machine),
 * parst CSV → Buchungen, und stößt den Auto-Abgleich für die betroffenen Monate an.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data erwartet" }, { status: 400 });
  }
  const file = form.get("file");
  const kind = String(form.get("kind") || "kontoauszug");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "file fehlt" }, { status: 400 });
  if (!["kontoauszug", "kreditkarte"].includes(kind)) return NextResponse.json({ error: "kind ungültig" }, { status: 400 });

  const fileName = (file instanceof File ? file.name : "auszug") || "auszug";
  const mime = file.type || (/\.csv$/i.test(fileName) ? "text/csv" : "application/pdf");
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(new Uint8Array(bytes)).digest("hex");

  const dup = await prisma.beleg.findUnique({ where: { fileSha: sha } });
  if (dup) return NextResponse.json({ error: "schon hochgeladen", belegId: dup.id }, { status: 409 });

  // Buchungen parsen (CSV; PDF liefert leer = nur Archiv) → Monat aus erster Buchung ableiten.
  const bookings = parseStatement(bytes, fileName, mime);
  const period =
    String(form.get("periodMonth") || "") ||
    (bookings.length ? monthOf(bookings[0].bookingDate) : monthOf(new Date()));
  const safeName = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "auszug";
  const storagePath = `${kind}/${period}/${sha.slice(0, 16)}-${safeName}`;
  await uploadBeleg(storagePath, new Uint8Array(bytes), mime);

  const beleg = await prisma.beleg.create({
    data: {
      kind,
      source: "upload",
      vendor: kind === "kreditkarte" ? "Kreditkarte" : "Kontoauszug",
      periodMonth: period,
      currency: bookings[0]?.currency || "EUR",
      fileName,
      fileMime: mime,
      fileSize: bytes.byteLength,
      storagePath,
      fileSha: sha,
      status: "collected",
    },
  });

  if (bookings.length) {
    await prisma.buchung.createMany({
      data: bookings.map((b) => ({
        belegId: beleg.id,
        bookingDate: b.bookingDate,
        amount: b.amount,
        currency: b.currency,
        counterparty: b.counterparty,
        purpose: b.purpose,
        reference: b.reference,
        raw: b.raw,
      })),
    });
  }

  // Auto-Abgleich für alle Monate, die in diesem Auszug vorkommen.
  const months = new Set<string>([period, ...bookings.map((b) => monthOf(b.bookingDate))]);
  let autoMatched = 0;
  for (const m of months) autoMatched += await autoMatchPeriod(m);

  return NextResponse.json({ beleg: toBelegDTO(beleg), parsed: bookings.length, autoMatched });
}
