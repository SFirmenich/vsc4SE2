# Rubrics

The current teacher assessment contract is task-oriented and stored under:

```text
assessment/
|-- rubrics/
`-- solutions/
```

Each task declared in `manifest.tasks[*].id` must have a private YAML rubric at
`assessment/rubrics/<taskId>.yml` and an official solution at
`assessment/solutions/<taskId>.md`. The sum of all task rubric `maxScore` values
must be 100.

Rubric YAML criteria are private-only. Public acceptance criteria remain in
`manifest.tasks[*].acceptanceCriteria`.

See [Assessment rubric YAML](assessment-rubrics.md) for the complete format and
examples.

Legacy activities may still contain `rubrics/main.json`. The teacher extension
can validate that file for backward compatibility, but new activities should use
the per-task assessment structure.
