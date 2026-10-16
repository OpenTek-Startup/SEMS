# YESE API contract — Academic structure (Phase 2, step 1)

Module: **academic**. Every route answers `403 MODULE_INACTIVE` while the school has not switched the
module on, and needs a signed-in user of the school (`X-Tenant` in development).

| Permission | Allows |
|---|---|
| `academic.structure.view` | every `GET` below (administrators, teachers, exam officers) |
| `academic.structure.manage` | every change (administrators) |

Dates are calendar days written `YYYY-MM-DD` (e.g. `2026-09-07`), in requests and responses.
Names are trimmed and compared without regard to case (`form 1` = `Form 1`).
Every change is written to the audit log (`academic.*` actions).

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/academic/current` | — | `{ year, term }` (each `null` when there is none) |
| GET | `/academic/years` | — | `AcademicYear[]`, newest first |
| POST | `/academic/years` | `{ name, startDate, endDate }` | `AcademicYear` (201) |
| PATCH | `/academic/years/:id` | any of `{ name, startDate, endDate }` | `AcademicYear` |
| POST | `/academic/years/:id/current` | — | `AcademicYear` — makes it the current year |
| DELETE | `/academic/years/:id` | — | `{ id, deleted: true }` |
| POST | `/academic/years/:id/terms` | `{ name, startDate, endDate }` | the year, with its terms (201) |
| PATCH | `/academic/terms/:id` | any of `{ name, startDate, endDate }` | the year, with its terms |
| DELETE | `/academic/terms/:id` | — | the year, with its terms |
| GET | `/academic/classes` | — | `SchoolClass[]`, by level |
| POST | `/academic/classes` | `{ name, level }` | `SchoolClass` (201) |
| PATCH | `/academic/classes/:id` | any of `{ name, level }` | `SchoolClass` |
| DELETE | `/academic/classes/:id` | — | `{ id, deleted: true }` |
| PUT | `/academic/classes/:id/subjects` | `{ subjects: [{ subjectId, coefficient }] }` | `SchoolClass` — replaces the whole list |
| POST | `/academic/classes/:id/sections` | `{ name, capacity? }` | the class (201) |
| GET | `/academic/sections` | — | `SectionListItem[]` — every section, flat, for pickers |
| PATCH | `/academic/sections/:id` | any of `{ name, capacity }` (`capacity: null` removes it) | the class |
| DELETE | `/academic/sections/:id` | — | the class |
| GET | `/academic/subjects` | — | `Subject[]`, by name |
| POST | `/academic/subjects` | `{ code, name }` | `Subject` (201) |
| PATCH | `/academic/subjects/:id` | any of `{ code, name }` | `Subject` |
| DELETE | `/academic/subjects/:id` | — | `{ id, deleted: true }` |

Limits: `level` 1–30, `capacity` 1–500, `coefficient` 1–20 (whole numbers), subject `code` 1–12 letters,
digits or dashes (stored in capitals: ` math ` → `MATH`).

## Shapes

```json
// AcademicYear
{
  "id": "uuid", "name": "2026-2027", "startDate": "2026-09-07", "endDate": "2027-06-30", "isCurrent": true,
  "terms": [
    { "id": "uuid", "name": "First Term", "startDate": "2026-09-07", "endDate": "2026-12-11", "isCurrent": true }
  ]
}

// SchoolClass
{
  "id": "uuid", "name": "Form 1", "level": 1,
  "sections": [{ "id": "uuid", "name": "A", "label": "Form 1 A", "capacity": 50 }],
  "subjects": [{ "subjectId": "uuid", "code": "MATH", "name": "Mathematics", "coefficient": 4 }],
  "totalCoefficient": 4
}

// SectionListItem
{ "id": "uuid", "name": "A", "label": "Form 1 A", "capacity": 50, "classId": "uuid", "className": "Form 1", "level": 1 }

// Subject
{ "id": "uuid", "code": "MATH", "name": "Mathematics", "classCount": 5 }
```

- A term's `isCurrent` is true when its year is current and today falls inside it.
- The first academic year a school creates becomes its current year; there is never more than one.

## Rules and error codes

| HTTP | `error.code` | When |
|---|---|---|
| 400 | (validation) | malformed body or id (not a UUID), unknown field, blank name |
| 400 | `DATE_INVALID` | not a real day (`2027-02-30`) |
| 400 | `DATES_INVALID` | the end is not after the start |
| 400 | `YEAR_TOO_LONG` | a year longer than 550 days (typing mistake guard) |
| 400 | `TERM_OUTSIDE_YEAR` | a term does not fit between its year's dates |
| 400 | `SUBJECT_CODE_INVALID` | code not 1–12 letters, digits or dashes |
| 400 | `DUPLICATE_SUBJECT` / `UNKNOWN_SUBJECT` | class subject list repeats a subject / names one that is not in the school |
| 404 | `YEAR_NOT_FOUND`, `TERM_NOT_FOUND`, `CLASS_NOT_FOUND`, `SECTION_NOT_FOUND`, `SUBJECT_NOT_FOUND` | unknown id, **or an id of another school** |
| 409 | `NAME_TAKEN` | name already used (year/class/subject per school, term per year, section per class) |
| 409 | `CODE_TAKEN` | subject code already used |
| 409 | `YEARS_OVERLAP` (`with`) | the dates overlap another academic year |
| 409 | `TERMS_OVERLAP` (`with`) | the dates overlap another term of the year (both ends count) |
| 409 | `YEAR_TERMS_OUTSIDE` (`terms`) | new year dates would leave some terms outside |
| 409 | `YEAR_IS_CURRENT` | deleting the current year |
| 409 | `YEAR_NOT_EMPTY` | deleting a year that still has terms |
| 409 | `CLASS_NOT_EMPTY` | deleting a class that still has sections |
| 409 | `SUBJECT_IN_USE` (`classes`) | deleting a subject still taught in some classes |
| 403 | `MODULE_INACTIVE` / `PERMISSION_DENIED` | module off / missing permission |

## Audit entries

`academic.year.created|updated|deleted|set_current`, `academic.term.created|updated|deleted`,
`academic.class.created|updated|deleted|subjects_updated`, `academic.section.created|updated|deleted`,
`academic.subject.created|updated|deleted`. `detail.name` holds the readable name (e.g. `Form 1 A`).

## Frontend

- `lib/api/academicApi.ts` — RTK Query hooks (`useGetYearsQuery`, `useGetSectionsQuery`, …), one cache tag `Academic`.
- `/academic` page (tabs: Years & terms, Classes & sections, Subjects); menu entry shown only with
  `academic.structure.view` and the module active.
- `useGetSectionsQuery()` and `useGetCurrentPeriodQuery()` are the ones the next steps (enrollment,
  registers, marks) will reuse.
