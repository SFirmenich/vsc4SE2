# VSCode4Education Agent Instructions

## Project Purpose

VSCode4Education is an ecosystem for programming learning activities centered on
portable activity and submission packages:

- `VSC4EducationTeacher` authors, validates, exports, imports, reviews, and gives
  feedback on learning activities and student submissions.
- `VSC4EducationStudents` imports learning activities, prepares the student
  workspace, tracks local evidence, manages task state, exports submissions, and
  generates local agent instructions.
- `VSC4EducationRepository` stores activity packages and student submissions,
  extracts metadata, and provides course/group metrics and comparisons through a
  Django, React, and Electron local application.

The most important invariant in this repository is end-to-end compatibility:

```text
Teacher activity export
-> Repository activity import when used
-> Student activity import
-> Student submission export
-> Repository submission import when used
-> Teacher submission import/review
```

Any change that affects files, schemas, paths, ZIP structure, events, Git
metadata, task state, agent instructions, rubrics, or submission contents must
preserve that full chain unless the change is explicitly a documented breaking
format change.

## Compatibility Contract

The shared contract is file-based. Do not treat any component's UI, internal
implementation, or the repository application's database as the source of truth.
The source of truth is the portable activity/submission structure documented in:

- `docs/project-and-extensions-spec.md`
- `docs/activity-format.md`
- `docs/events.md`
- `docs/repository.md`
- `docs/teacher-activity-authoring.md`
- `docs/submission-review.md`

An exported activity must remain importable by the student extension. A student
workspace produced from that activity must remain exportable as a submission. A
student submission must remain importable and reviewable by the teacher
extension. When `VSC4EducationRepository` is involved, the same activity and
submission ZIPs must remain importable there without making Repository-specific
database rows or summaries part of the portable format.

## Activity Package Rules

When changing activity authoring, validation, packaging, examples, or import
logic, preserve support for this package shape:

```text
activity/
|-- manifest.json
|-- theory/
|-- tasks/
|-- agent/
|   `-- instructions.md
|-- starter/
|   `-- proyecto-base/
`-- signatures/
```

The student importer must continue to accept `manifest.json` at the ZIP root or
inside a single container directory, unless a documented format version changes
that behavior.

Required compatibility points:

- `manifest.json` identifies the activity and declares tasks.
- `manifest.tasks[*].id` is stable and is the canonical task reference.
- Task IDs must not be interpreted by array position.
- Task files and other package references are relative paths inside the package.
- `starter/proyecto-base/` is copied to the student workspace root.
- Academic package contents are preserved under `.vsc4education/`.
- `agent/instructions.md` remains the canonical source for generated agent
  instructions.

## Student Workspace Rules

After import, the student workspace contract centers on `.vsc4education/`:

```text
.vsc4education/
|-- activity-manifest.json
|-- activity-configuration.json
|-- theory/
|-- tasks/
|-- agent/
|-- starter/
|-- signatures/
`-- contributions/
```

Each student contribution must remain isolated:

```text
.vsc4education/contributions/<studentId>/
|-- profile.json
|-- state.json
|-- events.jsonl
|-- agent-interactions.jsonl
|-- AGENTS.generated.md
|-- current-task.json
`-- task-metadata/
```

Do not introduce shared mutable markers that can make one student's local state
overwrite another student's contribution. The active student identity is local
workspace state, not a repository-wide source of truth.

## Submission Rules

Student submissions must include enough information for the teacher extension to
review both product and process:

- project files
- `.vsc4education/activity-manifest.json`
- `.vsc4education/activity-configuration.json`
- `.vsc4education/contributions/<studentId>/`
- events and task metadata
- agent interaction logs when present
- Git history when available and enabled

Missing optional evidence, such as Git or agent interactions, should generally be
handled as missing data rather than a fatal error. Corrupt required JSON,
unreadable JSONL, invalid paths, and unsafe archive entries should be reported
clearly.

## Repository Application Rules

`VSC4EducationRepository` is a consumer and organizer of the shared portable
artifacts, not a replacement for teacher or student extension contracts.

When changing Repository import, storage, metrics, API, or desktop packaging:

- keep original uploaded activity and submission ZIPs as the durable artifact;
- treat database rows, checksums, metrics, and comparisons as derived data;
- preserve imports for the activity ZIP shape documented above;
- preserve imports for student submissions containing `.vsc4education/` and
  per-student contribution directories;
- match submissions to activities by `activity id` and `version`, not task
  position or UI labels;
- keep task references based on `manifest.tasks[*].id`;
- do not execute student code, install student dependencies, or run package
  scripts from imported submissions;
- treat all ZIP paths and uploaded contents as untrusted input;
- store warnings for missing optional evidence where possible instead of failing
  the whole import;
- fail clearly on unsafe archive entries, corrupt required JSON, missing
  required submission files, or mismatched activity versions;
- keep course and group assignment metadata outside the portable package
  contract unless a documented format change explicitly adds it.

Repository integration endpoints under `/api/integration/teacher/` should remain
thin adapters over the same import/review contract. Avoid adding behavior there
that bypasses validation used by the normal Repository API.

## Event And Evidence Rules

Events are JSON Lines and must remain parseable line by line. When adding or
renaming events, update both producer and consumer logic.

Important event families include:

- activity/session events
- student registration events
- task start and finish events
- file/editor/terminal tracking events
- heartbeat events
- submission export events
- agent instruction restoration events
- contribution integrity or foreign modification events

Preserve backward tolerance in review code where practical: older submissions
may contain legacy field names such as `type` or `event`.

The hash chain and local metadata are review aids, not forensic guarantees. Do
not present them as tamper-proof.

## Agent Instruction Rules

The student extension does not use private APIs from ChatGPT, Claude, Copilot,
Codex, or similar tools. Agent integration happens through generated files such
as `AGENTS.md`, `.vsc4education/agent/instructions.master.md`, and contribution
logs.

When changing generated agent instructions:

- keep the teacher-authored instructions as the canonical pedagogical input;
- preserve the technical contract for logging agent interactions;
- keep restoration behavior compatible with existing activities;
- avoid embedding direct solutions to activities in generated instructions.

## Schema And Versioning Rules

Before changing a schema or file format, check all affected stages of the chain:

1. Teacher export or authoring validation.
2. Student import and workspace creation.
3. Student submission export.
4. Repository activity or submission import when the artifact can pass through
   `VSC4EducationRepository`.
5. Teacher submission import and review.

If a change is backward compatible, tests should prove the old and new shapes
work where relevant. If a change is breaking, document it in the relevant docs,
update examples, and make the format/version implications explicit.

Prefer additive fields over renames or removals. If a field must be renamed,
support both names during a transition when feasible.

## Testing Expectations

For changes touching the compatibility chain, run or add focused tests that cover
the affected direction:

- teacher activity validation/package export
- student ZIP import
- student task/event/submission export
- repository activity/submission ZIP import and metrics extraction
- teacher submission import/review

Useful commands:

```powershell
cd VSC4EducationStudents
npm test

cd ../VSC4EducationTeacher
npm test

cd ../VSC4EducationRepository/backend
python manage.py test
```

If full tests are too expensive for a small change, run the narrowest relevant
compile/test command and state the remaining risk.

## Implementation Guidance

- Keep changes scoped to the extension and contract surface involved.
- Reuse existing services and utilities for paths, JSON, ZIP handling,
  validation, hashing, and Git.
- In Repository code, prefer the existing import services, serializers, and
  metrics services over duplicating ZIP parsing or summary extraction.
- Treat archive paths as untrusted input.
- Avoid writing outside the selected workspace, extension storage locations, or
  Repository media/database locations.
- Do not delete user work, Git history, submissions, or contribution data.
- Keep documentation, examples, validation, import, export, and review behavior
  aligned.

When in doubt, protect the full lifecycle:

```text
activity ZIP -> repository import -> imported workspace -> submission ZIP -> repository import -> teacher review
```
