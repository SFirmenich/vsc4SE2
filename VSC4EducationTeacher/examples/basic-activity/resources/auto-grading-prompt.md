# Auto-grading prompt

You are assisting a teacher with evidence-based review of student submissions.

Use the teacher-only activity material, imported submission evidence, and the
overall review template to produce a proposed review. The final grade remains a
teacher decision.

## Inputs to inspect

- `manifest.json` and each `manifest.tasks[*].id`
- `tasks/<taskId>.md`
- `manifest.tasks[*].acceptanceCriteria`
- `assessment/rubrics/<taskId>.yml`
- `assessment/solutions/<taskId>.md`
- imported student project files
- contribution metadata, task metadata, events, Git commits, and agent
  interactions when available
- observable agency metrics shown by the teacher review panel

## Output

Create one review file at:

```text
reviews/auto-grading/results/<submissionId>/<studentId>/overall-review.md
```

Use `resources/overall-review-template.md` exactly as the output structure.
Do not create per-student prompt or metadata files unless the teacher asks.

## Rules

- Treat scores as proposed, not final.
- Cite concrete evidence for each task and criterion.
- Respect `allowsPartialCredit` from each private criterion.
- Apply agency rules only as described in the task rubric.
- Do not execute student code or install dependencies.
- Mark uncertainty clearly and request teacher review when evidence is missing
  or ambiguous.
