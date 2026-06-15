import type { Email, Customer, Todo } from "@prisma/client";
import type { EmailDTO, CustomerDTO } from "./types";

function safeLabels(s: string): string[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export function toEmailDTO(e: Email & { customer?: Customer | null }): EmailDTO {
  return {
    id: e.id,
    account: e.account,
    fromAddr: e.fromAddr,
    fromName: e.fromName,
    subject: e.subject,
    body: e.body,
    receivedAt: e.receivedAt.toISOString(),
    summary: e.summary,
    labels: safeLabels(e.labelsJson),
    firmenrelevant: e.firmenrelevant,
    priority: e.priority,
    filed: e.filed,
    outgoing: e.outgoing,
    customerId: e.customerId,
    customer: e.customer
      ? { id: e.customer.id, name: e.customer.name, meta: e.customer.meta, color: e.customer.color }
      : null,
  };
}

export function toCustomerDTO(
  c: Customer & { todos?: Todo[]; emails?: Email[] }
): CustomerDTO {
  const todos = c.todos ?? [];
  return {
    id: c.id,
    name: c.name,
    meta: c.meta,
    color: c.color,
    openTodos: todos.filter((t) => !t.done).length,
    todos: todos.map((t) => ({ id: t.id, text: t.text, done: t.done })),
    emailCount: c.emails?.length ?? 0,
  };
}
