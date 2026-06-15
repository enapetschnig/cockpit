/**
 * Zentrale Sync-Logik – von /api/gmail/sync (manuell) UND vom Auto-Sync
 * (src/instrumentation.ts, alle paar Minuten) gemeinsam genutzt.
 *
 * Holt neue Mails aller verbundenen Postfächer, klassifiziert sie mit der KI,
 * legt sie in der DB ab und pusht NEUE firmenrelevante Mails per Telegram.
 */
import { prisma } from "./db";
import { fetchNewRawMails, listAccounts, markSynced, isGmailConfigured, type Account } from "./gmail";
import { classifyEmail } from "./openai";
import { sendTelegram } from "./telegram";

export interface SyncResult {
  imported: number;
  perAccount: Record<string, number>;
  errors: string[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ACC_LABEL: Record<string, string> = { firma: "Firma", privat: "Privat" };

export async function runSync(opts?: { notify?: boolean }): Promise<SyncResult> {
  const notify = opts?.notify ?? true;
  const res: SyncResult = { imported: 0, perAccount: {}, errors: [] };

  if (!(await isGmailConfigured())) {
    res.errors.push("Gmail nicht konfiguriert");
    return res;
  }

  let connected: { account: string; connected: boolean }[];
  try {
    connected = (await listAccounts()).filter((a) => a.connected);
  } catch (e) {
    res.errors.push("Status/DB: " + (e as Error).message);
    return res;
  }
  if (connected.length === 0) return res;

  for (const a of connected) {
    try {
      const raws = await fetchNewRawMails(a.account as Account);
      let count = 0;
      for (const r of raws) {
        try {
          // Gesendete Mails: nicht klassifizieren, nicht firmenrelevant, kein Push.
          const c = r.outgoing
            ? null
            : await classifyEmail({ account: r.account, fromName: r.fromName, fromAddr: r.fromAddr, subject: r.subject, body: r.body });
          const firmenrelevant = c?.firmenrelevant ?? false;
          const created = await prisma.email.create({
            data: {
              account: r.account,
              gmailId: r.gmailId,
              threadId: r.threadId,
              outgoing: r.outgoing,
              fromAddr: r.fromAddr,
              fromName: r.fromName,
              subject: r.subject,
              body: r.body,
              receivedAt: r.receivedAt,
              summary: c?.summary ?? null,
              labelsJson: JSON.stringify(c?.labels ?? []),
              firmenrelevant,
              priority: c?.priority ?? "lo",
              classifiedAt: new Date(),
            },
          });
          count++;
          res.imported++;

          // Push nur für eingehende, firmenrelevante Mails – und nur einmal (notifiedAt).
          if (notify && firmenrelevant && !r.outgoing) {
            const tag = c!.priority === "hi" ? "❗️ Wichtig · " : "";
            const sent = await sendTelegram(
              `📨 <b>${tag}Neue firmenrelevante Mail</b> · ${ACC_LABEL[a.account] ?? a.account}\n` +
                `<b>${esc(r.fromName)}</b>: ${esc(r.subject)}\n${esc(c!.summary)}\n\n` +
                `<i>↩️ Antworte (Text/Sprache) – ich formuliere eine Antwort zum Kontrollieren.</i>`
            );
            await prisma.email.update({
              where: { id: created.id },
              data: { notifiedAt: new Date(), telegramMsgId: sent.messageId ? String(sent.messageId) : null },
            });
          }
        } catch (e) {
          // Doppelte gmailId (Race local+Vercel) o. ä. -> diese Mail überspringen, Batch läuft weiter.
          if (!String((e as Error).message).includes("Unique constraint")) {
            console.error("[sync] mail", r.gmailId, (e as Error).message);
          }
        }
      }
      res.perAccount[a.account] = count;
      await markSynced(a.account as Account);
    } catch (e) {
      console.error("[sync]", a.account, e);
      res.errors.push(`${a.account}: ${(e as Error).message}`);
    }
  }
  return res;
}
