import { prisma } from '../config/prisma.js'

const runStatement = async (sql: string) => {
  try {
    await prisma.$executeRawUnsafe(sql)
  } catch (error) {
    console.error('[schemaGuard] Failed to run statement:', sql, error)
    throw error
  }
}

export const ensureSchemaCompatibility = async () => {
  await runStatement(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'SaleStatus' AND e.enumlabel = 'cancelada'
      ) THEN
        EXECUTE 'ALTER TYPE "SaleStatus" ADD VALUE ''cancelada''';
      END IF;
    END $$;
  `)

  await runStatement(`
    ALTER TABLE "Sale"
      ADD COLUMN IF NOT EXISTS "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
  `)

  await runStatement(`ALTER TABLE "SaleItem" ALTER COLUMN "productId" DROP NOT NULL;`)
  await runStatement(`
    ALTER TABLE "SaleItem"
      ADD COLUMN IF NOT EXISTS "customName" TEXT,
      ADD COLUMN IF NOT EXISTS "customSku" TEXT,
      ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
  `)
}
