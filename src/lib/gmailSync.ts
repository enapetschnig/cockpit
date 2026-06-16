/**
 * Zentrale Sync-Logik – von /api/gmail/sync (manuell) UND vom Auto-Sync
 * (src/instrumentation.ts, alle paar Minuten) gemeinsam genutzt.
 *
 * Holt neue Mails aller verbundenen Postfächer, klassifiziert sie mit der KI,
 * legt sie in der DB ab und pusht NEUE firmenrelevante Mails per Telegram.
 */
import { prisma } from "./db";
import { fetchNewRawMails, listAccounts, markSynced, isGmailConfigured, type Account, type RawMail } from "./gmail";
import { classifyEmail } from "./openai";
import { sendTelegram } from "./telegram";
import { looksLikeInvoice, captureBelegeFromEmail } from "./beleg";
import { isStorageConfigured } from "./supabase/server";

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
              suggestedTodosJson: JSON.stringify(c?.suggestedTodos ?? []),
              proposedEventJson: c?.proposedEvent ? JSON.stringify(c.proposedEvent) : null,
              firmenrelevant,
              priority: c?.priority ?? "lo",
              classifiedAt: new Date(),
            },
          });
          count++;
          res.imported++;

          // Follow-up-Radar: bei einer gesendeten Mail den ganzen Thread als beantwortet markieren.
          if (r.outgoing && r.threadId) {
            await prisma.email.updateMany({
              where: { threadId: r.threadId, outgoing: false, repliedAt: null },
              data: { repliedAt: new Date() },
            });
          }

          // Push nur für eingehende, firmenrelevante Mails – und nur einmal (notifiedAt).
          if (notify && firmenrelevant && !r.outgoing) {
            const tag = c!.priority === "hi" ? "❗️ Wichtig · " : "";
            const suggestion = (c!.suggestedTodos ?? [])[0];
            const pe = c!.proposedEvent;
            const peLine = pe ? `\n📅 <i>Termin erkannt: ${esc(pe.title)} (${pe.start.slice(0, 16).replace("T", " ")})</i>` : "";
            const actionRow = [
              { text: "✅ Aufgabe", data: `todo:${created.id}` },
              { text: "💰 Buchhaltung", data: `file:${created.id}` },
            ];
            const buttons = pe ? [[{ text: "📅 Termin eintragen", data: `cev:${created.id}` }], actionRow] : [actionRow];
            const sent = await sendTelegram(
              `📨 <b>${tag}Neue firmenrelevante Mail</b> · ${ACC_LABEL[a.account] ?? a.account}\n` +
                `<b>${esc(r.fromName)}</b>: ${esc(r.subject)}\n${esc(c!.summary)}` +
                (suggestion ? `\n\n💡 <i>${esc(suggestion)}</i>` : "") +
                peLine +
                `\n\n<i>↩️ Antworte (Text/Sprache) für eine Antwort.</i>`,
              { buttons }
            );
            await prisma.email.update({
              where: { id: created.id },
              data: { notifiedAt: new Date(), telegramMsgId: sent.messageId ? String(sent.messageId) : null },
            });
          }

          // Buchhaltung: aus Rechnungs-Mails den Beleg (PDF) erfassen – nie den Sync sprengen.
          if (!r.outgoing) await maybeCaptureBeleg(r, created.id, c?.labels ?? [], notify);
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

/**
 * Erfasst – wenn die Mail wie eine Rechnung aussieht – den Beleg (PDF) in Storage + DB.
 * Pusht NEUE Belege (Mail jünger als 2 Tage) per Telegram mit "An BMD senden"-Button.
 * Vollständig in try/catch: schlägt die Erfassung fehl (z. B. Storage nicht konfiguriert),
 * läuft der Sync normal weiter.
 */
async function maybeCaptureBeleg(r: RawMail, emailId: string, labels: string[], notify: boolean): Promise<void> {
  try {
    if (!looksLikeInvoice(r, labels)) return;
    if (!(await isStorageConfigured())) return;
    const beleg = await captureBelegeFromEmail(emailId, r);
    if (!beleg) return; // schon erfasst (Dedup) oder kein PDF

    const recent = Date.now() - r.receivedAt.getTime() < 2 * 24 * 3600_000;
    if (notify && recent) {
      const amt = beleg.amount != null ? ` · ${beleg.amount} ${beleg.currency}` : "";
      const sent = await sendTelegram(
        `🧾 <b>Rechnung erfasst</b> · ${esc(beleg.vendor)}${amt}\n<i>${esc(beleg.fileName || "")}</i>\nAn BMD senden?`,
        {
          buttons: [[
            { text: "📤 An BMD senden", data: `bmd:${beleg.id}` },
            { text: "🚫 Ignorieren", data: `bmdx:${beleg.id}` },
          ]],
        }
      );
      await prisma.beleg.update({ where: { id: beleg.id }, data: { notifiedAt: new Date() } }).catch(() => {});
      void sent;
    }
  } catch (e) {
    console.error("[sync] beleg-capture", r.gmailId, (e as Error).message);
  }
}
