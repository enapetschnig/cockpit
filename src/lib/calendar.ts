/**
 * Google-Kalender-Anbindung – nutzt dieselben OAuth-Tokens wie Gmail (pro Konto),
 * nur mit zusätzlichem Scope calendar.events. Greift auf den Primär-Kalender zu.
 */
import { google } from "googleapis";
import { prisma } from "./db";
import { getConfig } from "./config";

export type Account = "firma" | "privat";
const TZ = "Europe/Vienna";

async function calendarClient(account: Account) {
  const acc = await prisma.gmailAccount.findUnique({ where: { account } });
  if (!acc?.refreshToken) throw new Error(`Konto "${account}" ist nicht verbunden.`);
  const [clientId, clientSecret] = await Promise.all([getConfig("GOOGLE_CLIENT_ID"), getConfig("GOOGLE_CLIENT_SECRET")]);
  if (!clientId || !clientSecret) throw new Error("Google-Zugangsdaten fehlen.");
  const o = new google.auth.OAuth2(clientId, clientSecret);
  o.setCredentials({ refresh_token: acc.refreshToken });
  return google.calendar({ version: "v3", auth: o });
}

export interface CalEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  allDay: boolean;
}

/** Termine eines Kontos im Zeitraum (Standard: nächste 7 Tage). */
export async function listEvents(account: Account, opts?: { days?: number; max?: number }): Promise<CalEvent[]> {
  const cal = await calendarClient(account);
  const now = new Date();
  const timeMax = new Date(now.getTime() + (opts?.days ?? 7) * 86400000);
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: opts?.max ?? 25,
  });
  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    summary: e.summary ?? "(ohne Titel)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    location: e.location ?? undefined,
    allDay: !e.start?.dateTime,
  }));
}

/** Termin anlegen. start/end als "YYYY-MM-DDTHH:MM:SS" (Wiener Zeit) oder "YYYY-MM-DD" (ganztägig). */
export async function createEvent(
  account: Account,
  ev: { title: string; start: string; end: string; location?: string; description?: string }
): Promise<{ id: string; htmlLink: string; summary: string; start: string; end: string }> {
  const cal = await calendarClient(account);
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(ev.start);
  const startObj = allDay ? { date: ev.start } : { dateTime: ev.start, timeZone: TZ };
  const endObj = allDay ? { date: ev.end || ev.start } : { dateTime: ev.end || ev.start, timeZone: TZ };
  const res = await cal.events.insert({
    calendarId: "primary",
    requestBody: { summary: ev.title, location: ev.location, description: ev.description, start: startObj, end: endObj },
  });
  return {
    id: res.data.id ?? "",
    htmlLink: res.data.htmlLink ?? "",
    summary: res.data.summary ?? ev.title,
    start: res.data.start?.dateTime ?? res.data.start?.date ?? ev.start,
    end: res.data.end?.dateTime ?? res.data.end?.date ?? ev.end,
  };
}

export async function deleteEvent(account: Account, eventId: string): Promise<void> {
  const cal = await calendarClient(account);
  await cal.events.delete({ calendarId: "primary", eventId });
}
