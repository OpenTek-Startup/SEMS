YESE — ENTITY RELATIONSHIP DIAGRAMS (modular set)
=================================================
YESE_ERD_Data_Model.docx / .pdf   Full document: domain map + 7 per-domain ERDs + data dictionary.
png/   High-resolution images (double-click to view).
svg/   Vector versions (open in a web browser; crisp at any zoom).
plantuml/  Editable PlantUML sources. Keep _theme.puml in the same folder.

DIAGRAMS
  overview        Domain map & cross-domain relationships
  core            Core Platform (Tenancy, Identity, RBAC, Module Registry, Audit)
  student_staff   Student & Staff domains
  academic        Academic structure & Enrollment
  academic_ops    Attendance, Assessment, Results
  finance         Finance
  hr_payroll      HR & Payroll
  comms           Communication & Notifications

NOTES
  - Database: PostgreSQL. Every tenant-owned table carries tenant_id.
  - Notation: crow's-foot. PK / FK / UQ marked; * = NOT NULL.
  - To re-render:  java -jar plantuml.jar -Playout smetana -tpng core.puml
    (the sources already contain the "!pragma layout smetana" line, so plain
     "java -jar plantuml.jar -tpng *.puml" also works without Graphviz).
