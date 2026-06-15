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
        const c = await classifyEmail({
          account: r.account,
          fromName: r.fromName,
          fromAddr: r.fromAddr,
          subject: r.subject,
          body: r.body,
        });
        await prisma.email.create({
          data: {
            account: r.account,
            gmailId: r.gmailId,
            threadId: r.threadId,
            fromAddr: r.fromAddr,
            fromName: r.fromName,
            subject: r.subject,
            body: r.body,
            receivedAt: r.receivedAt,
            summary: c.summary,
            labelsJson: JSON.stringify(c.labels),
            firmenrelevant: c.firmenrelevant,
            priority: c.priority,
            classifiedAt: new Date(),
          },
        });
        count++;
        res.imported++;

        // Push nur für NEUE firmenrelevante Mails
        if (notify && c.firmenrelevant) {
          const tag = c.priority === "hi" ? "❗️ Wichtig · " : "";
          await sendTelegram(
            `📨 <b>${tag}Neue firmenrelevante Mail</b> · ${ACC_LABEL[a.account] ?? a.account}\n` +
              `<b>${esc(r.fromName)}</b>: ${esc(r.subject)}\n${esc(c.summary)}`
          );
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
