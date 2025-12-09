-- Remove default autoincrement from sequence and allow nulls
ALTER TABLE "Sale" ALTER COLUMN "sequence" DROP DEFAULT;
ALTER TABLE "Sale" ALTER COLUMN "sequence" DROP NOT NULL;

-- Create counter table to control numbering
CREATE TABLE IF NOT EXISTS "SaleCounter" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "current" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "SaleCounter" ("id", "current")
VALUES (1, 0)
ON CONFLICT ("id") DO NOTHING;

-- Reset existing sequence/publicId so new ones recomeçam do 0001
UPDATE "Sale" SET "sequence" = NULL;
UPDATE "Sale" SET "publicId" = NULL;

-- Monthly goal registry per month/year
CREATE TABLE IF NOT EXISTS "MonthlyGoal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "target" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyGoal_year_month_key" ON "MonthlyGoal"("year", "month");
