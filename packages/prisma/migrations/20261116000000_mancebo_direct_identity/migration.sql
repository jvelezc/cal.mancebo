ALTER TYPE "IdentityProvider" ADD VALUE 'MANCEBO';
ALTER TABLE "users" ADD COLUMN "manceboUserId" UUID;
CREATE UNIQUE INDEX "users_manceboUserId_key" ON "users"("manceboUserId");
