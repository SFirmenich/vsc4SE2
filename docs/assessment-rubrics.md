# Assessment Rubric YAML

Teacher-only assessment material lives under `assessment/`.

```text
assessment/
|-- rubrics/
|   |-- encapsulamiento.yml
|   `-- herencia.yml
`-- solutions/
    |-- encapsulamiento.md
    `-- herencia.md
```

For every task declared in `manifest.tasks[*].id`, the teacher package must
contain:

- `assessment/rubrics/<taskId>.yml`
- `assessment/solutions/<taskId>.md`

These files are private authoring and review material. They are included in the
teacher package ZIP and excluded from the student activity ZIP.

## Schema

The JSON Schema for rubric YAML is stored at:

```text
docs/schemas/assessment-rubric.schema.json
```

New teacher activity projects also receive a local copy at:

```text
resources/assessment-rubric.schema.json
```

The same `resources/` directory stores generic teacher-side review templates,
including `auto-grading-prompt.md` and `overall-review-template.md`.
`resources/` is included in teacher package ZIPs and excluded from student
activity ZIPs.

YAML does not have an XSD-equivalent schema language built into the format. The
rubric YAML is parsed as structured data and validated with JSON Schema plus
extra semantic checks performed by the teacher extension, such as score totals.

In VS Code, the schema can be associated with activity rubrics through the YAML
extension settings:

```json
{
  "yaml.schemas": {
    "./resources/assessment-rubric.schema.json": "assessment/rubrics/*.yml"
  }
}
```

## YAML Shape

Each rubric YAML describes one task. Criteria are always private; do not add
`publicCriteria` or `visibility` fields here. Public acceptance criteria belong
in `manifest.tasks[*].acceptanceCriteria`.

```yaml
taskId: encapsulamiento
maxScore: 35
requiresTeacherReview: true

criteria:
  - id: private-state
    title: Estado interno protegido
    maxScore: 10
    allowsPartialCredit: true
    description: Usa estado privado o protegido y evita modificacion directa.

  - id: invariant
    title: Conserva invariantes
    maxScore: 15
    allowsPartialCredit: true
    description: No permite nombres vacios ni energia negativa.

  - id: api
    title: API clara
    maxScore: 10
    allowsPartialCredit: false
    description: Expone operaciones coherentes para consultar y modificar estado.

agency:
  mode: none
```

## Required Fields

`taskId`:
Optional, but recommended. If present, it must match the file name and the
manifest task ID.

`maxScore`:
Maximum score for this task. The sum of all task `maxScore` values across
`assessment/rubrics/*.yml` must be 100.

`requiresTeacherReview`:
Boolean. Use `true` when the agent can propose a score but the teacher must
confirm it. Use `false` only for tasks that can be evaluated fully from
objective checks.

`criteria`:
Private evaluation criteria for the task. The sum of criterion `maxScore`
values must match the task `maxScore`, except when `agency.mode` is `weighted`.

`allowsPartialCredit`:
Boolean required for every criterion. When `true`, a criterion worth 10 points
may receive an intermediate score such as 7. When `false`, the criterion is
all-or-nothing: a partial or advanced-but-wrong attempt should still receive
either 0 or the full `maxScore`.

## Agency Section

The `agency` section defines how observable agency metrics affect the task
score. Agency metrics are review signals, not proof of authorship.

Supported modes:

```yaml
agency:
  mode: none
```

No agency adjustment is applied.

```yaml
agency:
  mode: weighted
  maxScore: 5
```

Agency contributes part of the task score. If `maxScore` is 35 and agency
`maxScore` is 5, criteria must total 30.

```yaml
agency:
  mode: modifier
  maxAdjustment: 5
  rules:
    - metric: observableAgency.score
      when: ">= 80"
      adjustment: 5
      reason: Evidencia fuerte de trabajo trazable.
    - metric: observableAgency.score
      when: "< 40"
      adjustment: -5
      reason: Evidencia debil de proceso.
```

Agency adjusts the criterion score up or down, bounded by `maxAdjustment` and
the task `maxScore`.

```yaml
agency:
  mode: cap
  rules:
    - metric: observableAgency.score
      when: "< 30"
      cap: 20
      reason: Trazabilidad insuficiente para validar todo el proceso.
```

Agency can cap the maximum score proposed for the task.

```yaml
agency:
  mode: bonus
  maxAdjustment: 3
  rules:
    - metric: observableAgency.score
      when: ">= 90"
      adjustment: 3
      reason: Proceso excepcionalmente trazable.
```

Agency can add a bonus, without allowing the final activity score to exceed 100.

## Official Solution Markdown

The matching solution file should guide the teacher agent without implying that
only one answer is valid.

```markdown
# Official solution: Encapsulamiento

## Expected intent

## Reference implementation

## Acceptable variants

## Common mistakes

## Notes for assisted evaluation
```

## Validation Rules

The teacher extension validates that:

- `assessment/`, `assessment/rubrics/`, and `assessment/solutions/` exist.
- Each manifest task has one matching YAML rubric and one matching solution.
- Assessment files do not reference unknown task IDs.
- Each rubric has a positive `maxScore`.
- The activity assessment total is 100.
- Each criterion has a valid ID, `maxScore`, and explicit
  `allowsPartialCredit`.
- Criteria are private-only and do not define `visibility` or
  `publicCriteria`.
- Weighted agency reserves points from the task score.

The student ZIP excludes `assessment/` entirely. The teacher package ZIP keeps
it for review and agent-assisted scoring.
