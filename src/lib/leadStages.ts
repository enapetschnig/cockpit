import { prisma } from "@/lib/db";
import type { LeadStageDTO } from "@/lib/types";

// Default-Pipeline (wird pro Konto einmalig angelegt). Reihenfolge = order.
export const DEFAULT_STAGES: { key: string; label: string; color: string }[] = [
  { key: "new", label: "Neu", color: "#d8932a" },
  { key: "contacted", label: "Angerufen", color: "#2f6df0" },
  { key: "scheduled", label: "Termin", color: "#9a4fc4" },
  { key: "won", label: "Gewonnen", color: "#1f9d63" },
  { key: "lost", label: "Verloren", color: "#8a857c" },
];

export function toStageDTO(s: { id: string; key: string; label: string; color: string; order: number; isDefault: boolean }): LeadStageDTO {
  return { id: s.id, key: s.key, label: s.label, color: s.color, order: s.order, isDefault: s.isDefault };
}

// Liefert die Pipeline-Stufen eines Kontos; legt beim ersten Aufruf die Defaults an.
export async function ensureStages(accountId: string): Promise<LeadStageDTO[]> {
  const existing = await prisma.leadStage.findMany({ where: { adAccountId: accountId }, orderBy: { order: "asc" } });
  if (existing.length > 0) return existing.map(toStageDTO);
  await prisma.leadStage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({ adAccountId: accountId, key: s.key, label: s.label, color: s.color, order: i, isDefault: true })),
    skipDuplicates: true,
  });
  const seeded = await prisma.leadStage.findMany({ where: { adAccountId: accountId }, orderBy: { order: "asc" } });
  return seeded.map(toStageDTO);
}
