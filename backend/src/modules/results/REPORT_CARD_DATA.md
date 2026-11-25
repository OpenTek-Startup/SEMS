# Report card data (Track B to Track A handoff)

The report card page (Track A) shows one `ReportCardData` per student. The
type is in `results-rules.ts`; `report-card.sample.json` is real output of
the rules for a small Form 1 A (four students, six subjects, two sequences),
so the page can be built now and connected to the API later.

The endpoint will be:

    GET /api/results/report-cards?termId=&sectionId=   ->   ReportCardData[] (in rank order)

## How the numbers are made

- Every mark is brought to /20 (`score / maxScore * 20`).
- **Subject average**: weighted mean of the subject's assessments in the
  term (weight = the assessment's weight). An absence is left out; no score
  at all means no average in that subject (`average: null`).
- **Points** = subject average x coefficient.
- **General average** = total points / total coefficients, counting only the
  subjects where the student has an average (`totalCoefficient` says how many).
- **Rank**: highest average first; equal averages (2 decimals) share a rank
  and the next one is skipped (1, 2, 2, 4). No average, no rank.
- **Pass mark**: 10/20. `passRate` is a percentage of the classified students.
- **Appreciation**: 18 Excellent, 16 Very good, 14 Good, 12 Fairly good,
  10 Average, 8 Weak, below 8 Poor.
- Every average is rounded to 2 decimals.

## What the page shows (suggested)

Header: `school.name`, `year.name`, `term.name`, `section.label`, the
student's `fullName` and `matricule`.

One row per entry of `result.subjects`: subject, coefficient, average,
points, rank, appreciation, teacher. Show an empty cell when a value is `null`.

Footer: `totalCoefficient`, `totalPoints`, `average`, "rank `rank` of
`stats.classified`", `appreciation`, then from `stats`: class average,
highest, lowest, pass rate. `subjectStats` gives the class average per
subject if the card shows it.
