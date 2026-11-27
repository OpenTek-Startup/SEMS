-- CreateTable
CREATE TABLE "result_publications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_user_id" UUID NOT NULL,
    "published_by_name" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "result_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "result_publications_tenant_id_idx" ON "result_publications"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_publications_term_id_section_id_key" ON "result_publications"("term_id", "section_id");

-- AddForeignKey
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_publications" ADD CONSTRAINT "result_publications_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
