-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SaleItem" 
  ALTER COLUMN "productId" DROP NOT NULL,
  ADD COLUMN     "customName" TEXT,
  ADD COLUMN     "customSku" TEXT,
  ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;
