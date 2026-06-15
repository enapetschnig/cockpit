export type Priority = "hi" | "mid" | "lo";

export interface EmailDTO {
  id: string;
  account: "firma" | "privat" | string;
  fromAddr: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: string;
  summary: string | null;
  labels: string[];
  firmenrelevant: boolean;
  priority: Priority | string;
  filed: boolean;
  customerId: string | null;
  customer: { id: string; name: string; meta: string | null; color: string | null } | null;
}

export interface CustomerDTO {
  id: string;
  name: string;
  meta: string | null;
  color: string | null;
  openTodos: number;
  todos: { id: string; text: string; done: boolean }[];
  emailCount: number;
}

export interface ClassifyResult {
  summary: string;
  labels: string[];
  firmenrelevant: boolean;
  priority: Priority;
  suggestedTodos: string[];
}
