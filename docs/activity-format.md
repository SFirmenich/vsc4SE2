# Activity Format

An activity is a ZIP archive with `manifest.json` at the root. A single
container directory is also supported.

```text
activity.zip
|-- manifest.json
|-- theory/
|-- tasks/
|-- agent/
|   `-- instructions.md
|-- starter/
|   `-- Animal.ts
`-- signatures/
    `-- manifest.sig
```

## Manifest

```json
{
  "id": "poo-basico-01",
  "title": "Basic OOP",
  "description": "A practical introduction to classes and encapsulation.",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "encapsulation",
      "title": "Apply encapsulation",
      "description": "Protect the internal state of Animal.",
      "file": "tasks/task1.md"
    }
  ]
}
```

`id`, `title`, and a non-empty `tasks` list are required. Each task requires an
`id` and `title`; identifiers must be unique.

## Import

The contents of `starter/` are copied into the `src/` directory of the selected
workspace folder. For example, `starter/Animal.ts` becomes `src/Animal.ts`,
where the student works.

Legacy activity packages that contain `starter/proyecto-base/` are still
accepted by the student extension for compatibility.

The full academic package is preserved inside `.vsc4education/`:

```text
student-project/
|-- AGENTS.md
|-- src/
|-- package.json
`-- .vsc4education/
    |-- manifest.json
    |-- theory/
    |-- tasks/
    |-- agent/
    |   |-- instructions.md
    |   `-- instructions.master.md
    |-- starter/
    |-- signatures/
    |-- activity-configuration.json
    `-- contributions/
        |-- ana-001/
        |   |-- profile.json
        |   |-- state.json
        |   |-- events.jsonl
        |   |-- agent-interactions.jsonl
        |   `-- task-metadata/
        `-- juan-002/
```

`manifest.json`, `theory`, `tasks`, and `agent` are not copied directly to the
workspace root.

`AGENTS.md` is an exact copy of the canonical instructions stored in
`agent/instructions.master.md`. The extension restores both `AGENTS.md` and
`agent/instructions.md` if they are modified or deleted while the extension is
active.

The extension appends the technical contract required to record agent
interactions in JSONL format.

## Teacher-Only Assessment Material

Teacher source projects and teacher packages may contain private assessment
material:

```text
assessment/
|-- rubrics/
|   `-- <taskId>.yml
`-- solutions/
    `-- <taskId>.md
resources/
|-- assessment-rubric.schema.json
|-- auto-grading-prompt.md
`-- overall-review-template.md
```

For each manifest task ID, the teacher package should include one matching YAML
rubric and one matching official solution. This material is excluded from the
student activity ZIP. Public task acceptance criteria remain in
`manifest.tasks[*].acceptanceCriteria`.

`resources/` contains reusable teacher-side schemas and review templates. It is
included in teacher package ZIPs and excluded from student activity ZIPs.

See [Assessment rubric YAML](assessment-rubrics.md) for the YAML contract.

## Identity And Contributions

Before starting a task, the student must provide first name, last name, and an
institutional identifier. The normalized identifier is used as the contribution
directory name.

Each local VS Code installation stores the active contribution in
`workspaceState`. The extension only creates and updates state, events,
metadata, and conversations inside that contribution.

Changes detected inside another contribution generate a
`foreign_contribution_modified` event in the active student's contribution.

## Git Repository

On import:

- If no repository exists, the extension initializes one and creates the initial
  commit.
- If a repository exists without commits, the extension reuses it and creates
  its first commit.
- If history exists, the extension preserves it and records activity loading as
  a checkpoint.

When the workspace is opened later, no new load commit is created. The shared
configuration allows the extension to recover the repository mode and resume the
local contribution.

The `signatures/manifest.sig` file is preserved, but the MVP does not implement
cryptographic validation.

## Repository Import

`VSC4EducationRepository` imports this same activity ZIP format. It stores the
original archive, reads `manifest.json`, extracts activity and task metadata,
and associates the activity version with courses or groups.

Repository import requires `manifest.version` in addition to the base `id`,
`title`, and task requirements, because activity versions are the unit used to
match later submissions and compute comparisons.
