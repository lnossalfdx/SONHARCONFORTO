-- Add optional publicId and sequential helper column
ALTER TABLE "Sale"
  ADD COLUMN "sequence" SERIAL,
  ALTER COLUMN "publicId" DROP NOT NULL;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_sequence_key" UNIQUE("sequence");

-- Ensure existing rows have sequential values
UPDATE "Sale"
SET "sequence" = nextval(pg_get_serial_sequence('"Sale"', 'sequence'))
WHERE "sequence" IS NULL;
