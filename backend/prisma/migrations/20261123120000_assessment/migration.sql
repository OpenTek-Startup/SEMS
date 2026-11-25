-- CreateEnum
CREATE TYPE "assessment_status" AS ENUM ('open', 'submitted', 'validated', 'locked');

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "max_score" INTEGER NOT NULL DEFAULT 20,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "held_on" DATE,
    "status" "assessment_status" NOT NULL DEFAULT 'open',
    "submitted_at" TIMESTAMPTZ(3),
    "validated_at" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessments_tenant_id_idx" ON "assessments"("tenant_id");

-- CreateIndex
CREATE INDEX "assessments_section_id_idx" ON "assessments"("section_id");

-- CreateIndex
CREATE INDEX "assessments_academic_year_id_idx" ON "assessments"("academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_term_id_section_id_subject_id_name_key" ON "assessments"("term_id", "section_id", "subject_id", "name");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
