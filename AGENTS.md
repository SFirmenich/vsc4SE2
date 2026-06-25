# VSCode4Education Agent Instructions

## Project Purpose

VSCode4Education is a two-extension system for programming learning activities in
Visual Studio Code:

- `VSC4EducationTeacher` authors, validates, exports, imports, reviews, and gives
  feedback on learning activities and student submissions.
- `VSC4EducationStudents` imports learning activities, prepares the student
  workspace, tracks local evidence, manages task state, exports submissions, and
  generates local agent instructions.

The most important invariant in this repository is end-to-end compatibility:

```text
Teacher activity export
-> Student activity import
-> Student submission export
-> Teacher submission import/review
```

Any change that affects files, schemas, paths, ZIP structure, events, Git
metadata, task state, agent instructions, rubrics, or submission contents must
preserve that full chain unless the change is explicitly a documented breaking
format change.

## Compatibility Contract

The shared contract is file-based. Do not treat either extension's UI or internal
implementation as the source of truth. The source of truth is the portable
activity/submission structure documented in:

- `docs/project-and-extensions-spec.md`
- `docs/activity-format.md`
- `docs/events.md`
- `docs/teacher-activity-authoring.md`
- `docs/submission-review.md`

An exported activity must remain importable by the student extension. A student
workspace produced from that activity must remain exportable as a submission. A
student submission must remain importable and reviewable by the teacher
extension.

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

Before changing a schema or file format, check all four stages of the chain:

1. Teacher export or authoring validation.
2. Student import and workspace creation.
3. Student submission export.
4. Teacher submission import and review.

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
- teacher submission import/review

Useful commands:

```powershell
cd VSC4EducationStudents
npm test

cd ../VSC4EducationTeacher
npm test
```

If full tests are too expensive for a small change, run the narrowest relevant
compile/test command and state the remaining risk.

## Implementation Guidance

- Keep changes scoped to the extension and contract surface involved.
- Reuse existing services and utilities for paths, JSON, ZIP handling,
  validation, hashing, and Git.
- Treat archive paths as untrusted input.
- Avoid writing outside the selected workspace or extension storage locations.
- Do not delete user work, Git history, submissions, or contribution data.
- Keep documentation, examples, validation, import, export, and review behavior
  aligned.

When in doubt, protect the full lifecycle:

```text
activity ZIP -> imported workspace -> submission ZIP -> teacher review
```
