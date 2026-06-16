/**
 * Abgleich: ordnet Auszugs-Buchungen den gesammelten Rechnungen zu.
 * Auto-Match nur wenn Betrag exakt (±0,02) UND Buchung im Datumsfenster (−3…+10 Tage
 * zur Rechnung) UND (Vendor-Treffer ODER Betrag eindeutig). Idempotent (rührt nur "unmatched" an).
 * Aufschlüsselung: ✅ zugeordnet · ⚠️ Buchung ohne Beleg · 📄 Rechnung ohne Buchung.
 */
import { prisma } from "./db";
import { toBelegDTO, toBuchungDTO } from "./serialize";
import type { ReconcileMonthDTO } from "./types";
import type { Beleg } from "@prisma/client";

const STATEMENT_KINDS = ["kontoauszug", "kreditkarte"];

export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function num(d: unknown): number {
  return Math.abs(Number(d));
}
function dayDiff(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / 86_400_000;
}

function normalizeName(s: string | null): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(gmbh|gesmbh|inc|pbc|ag|ltd|llc|kg|se|sarl|corp|co|bv|oy|plc|limited|og)\b/g, " ")
    .replace(/\b(stripe|payment|payout|sepa|lastschrift|kartenzahlung|visa|mastercard|abo|subscription|paypal|recurring)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function vendorMatch(vendor: string, vendorKey: string | null, hay: string): boolean {
  const h = normalizeName(hay);
  if (!h) return false;
  const toks = new Set<string>();
  normalizeName(vendor).split(" ").forEach((t) => t.length >= 3 && toks.add(t));
  if (vendorKey && vendorKey.length >= 3) toks.add(vendorKey.toLowerCase());
  return [...toks].some((t) => h.includes(t));
}

/** Auto-Match für einen Monat. Gibt die Anzahl NEU zugeordneter Buchungen zurück. */
export async function autoMatchPeriod(periodMonth: string): Promise<number> {
  const invoices = await prisma.beleg.findMany({ where: { kind: "rechnung", periodMonth, amount: { not: null } } });
  if (!invoices.length) return 0;

  const allBookings = await prisma.buchung.findMany({
    where: { matchStatus: "unmatched", beleg: { kind: { in: STATEMENT_KINDS } } },
    orderBy: { bookingDate: "asc" },
  });
  const bookings = allBookings.filter((b) => monthOf(b.bookingDate) === periodMonth);
  if (!bookings.length) return 0;

  const matched = await prisma.buchung.findMany({
    where: { matchStatus: "matched", matchedBelegId: { not: null } },
    select: { matchedBelegId: true },
  });
  const taken = new Set(matched.map((m) => m.matchedBelegId!));

  let count = 0;
  for (const bk of bookings) {
    const bAmt = num(bk.amount);
    const free = invoices.filter((inv) => !taken.has(inv.id) && Math.abs(num(inv.amount) - bAmt) <= 0.02);
    if (!free.length) continue;

    const cands = free
      .map((inv) => {
        const d = inv.invoiceDate ? dayDiff(bk.bookingDate, inv.invoiceDate) : null;
        if (d == null || d < -3 || d > 10) return null;
        const hit = vendorMatch(inv.vendor, inv.vendorKey, `${bk.counterparty || ""} ${bk.purpose || ""}`);
        const score = 60 + (hit ? 35 : 0) - Math.min(Math.abs(d), 10);
        return { inv, score, hit };
      })
      .filter((x): x is { inv: Beleg; score: number; hit: boolean } => x != null)
      .sort((a, b) => b.score - a.score);
    if (!cands.length) continue;

    const best = cands[0];
    const amountUnique = free.length === 1;
    if (best.hit || amountUnique) {
      await prisma.buchung.update({
        where: { id: bk.id },
        data: { matchedBelegId: best.inv.id, matchStatus: "matched", matchConfidence: Math.max(0, Math.min(100, Math.round(best.score))) },
      });
      taken.add(best.inv.id);
      count++;
    }
  }
  return count;
}

/** Drei Buckets für einen Monat. */
export async function reconcileMonth(periodMonth: string): Promise<ReconcileMonthDTO> {
  const invoices = await prisma.beleg.findMany({ where: { kind: "rechnung", periodMonth }, orderBy: { createdAt: "desc" } });
  const allBookings = await prisma.buchung.findMany({
    where: { beleg: { kind: { in: STATEMENT_KINDS } } },
    orderBy: { bookingDate: "desc" },
  });
  const bookings = allBookings.filter((b) => monthOf(b.bookingDate) === periodMonth);

  const invById = new Map(invoices.map((i) => [i.id, i]));
  const matched: ReconcileMonthDTO["matched"] = [];
  const bookingsWithoutInvoice: ReconcileMonthDTO["bookingsWithoutInvoice"] = [];
  const matchedInvIds = new Set<string>();

  for (const bk of bookings) {
    if (bk.matchStatus === "matched" && bk.matchedBelegId) {
      const inv = invById.get(bk.matchedBelegId) || (await prisma.beleg.findUnique({ where: { id: bk.matchedBelegId } }));
      if (inv) {
        matched.push({ buchung: toBuchungDTO(bk), beleg: toBelegDTO(inv) });
        matchedInvIds.add(inv.id);
        continue;
      }
    }
    if (bk.matchStatus === "ignored") continue;
    bookingsWithoutInvoice.push(toBuchungDTO(bk));
  }

  const invoicesWithoutBooking = invoices.filter((i) => !matchedInvIds.has(i.id)).map(toBelegDTO);
  return { periodMonth, matched, bookingsWithoutInvoice, invoicesWithoutBooking };
}

/** Alle Monate (mit Rechnungen oder Buchungen), neueste zuerst. */
export async function reconcileAll(): Promise<ReconcileMonthDTO[]> {
  const invMonths = await prisma.beleg.findMany({
    where: { kind: "rechnung", periodMonth: { not: null } },
    select: { periodMonth: true },
    distinct: ["periodMonth"],
  });
  const bks = await prisma.buchung.findMany({ where: { beleg: { kind: { in: STATEMENT_KINDS } } }, select: { bookingDate: true } });
  const months = new Set<string>();
  invMonths.forEach((m) => m.periodMonth && months.add(m.periodMonth));
  bks.forEach((b) => months.add(monthOf(b.bookingDate)));
  const sorted = [...months].sort().reverse();
  return Promise.all(sorted.map(reconcileMonth));
}
