import { PrismaClient } from "@prisma/client";

// Prisma-Client als Singleton (verhindert zu viele Verbindungen im Dev-Hot-Reload).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
