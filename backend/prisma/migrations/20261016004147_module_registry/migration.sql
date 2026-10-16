-- AlterTable
ALTER TABLE "modules" ADD COLUMN     "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "tenant_modules" (
    "tenant_id" UUID NOT NULL,
    "module_code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" UUID,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("tenant_id","module_code")
);

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "modules"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
