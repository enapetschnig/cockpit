/**
 * Follow-up-Radar: firmenrelevante Eingangsmails, die seit Tagen unbeantwortet sind
 * (kein Reply im Thread, nicht abgelegt, nicht zurückgestellt). Umsatzkritischer Blindspot.
 */
import { prisma } from "./db";

export async function listFollowups(minHoursOld = 48, take = 20) {
  const cutoff = new Date(Date.now() - minHoursOld * 3600 * 1000);
  const now = new Date();
  return prisma.email.findMany({
    where: {
      outgoing: false,
      firmenrelevant: true,
      filed: false,
      repliedAt: null,
      receivedAt: { lte: cutoff },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    orderBy: { receivedAt: "asc" },
    take,
    include: { customer: true },
  });
}
