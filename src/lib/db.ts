import { PrismaClient } from "@prisma/client";

// Singleton, чтобы в dev-режиме hot-reload не плодил соединения.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
