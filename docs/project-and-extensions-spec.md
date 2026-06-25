# General Documentation And Extension Specification

This document defines the overall vision for **VSCode4Education** as a learning
activity system for programming, and establishes the main requirements for its
two extensions:

- **Learning Activity Tracker - Student**, the student extension implemented in
  this repository.
- **Learning Activity Tracker - Teacher**, the teacher extension for creating,
  validating, and reviewing activities and submissions.

The central idea is that both extensions operate on the same contract: a clear,
versioned, portable activity structure that is stable enough for one tool to
produce packages and another to consume them without relying on implicit
conventions.

## 1. Project Purpose

The project turns a programming practice into a learning activity importable by
VS Code. An activity is not only a starter project: it also contains theory,
tasks, pedagogical instructions for AI agents, configuration, evidence, and an
academic version.

The expected flow is:

1. The teacher designs an activity.
2. The teacher extension validates the structure and generates a ZIP package.
3. The student imports the package with the student extension.
4. The extension prepares the workspace, copies the starter project, and
   preserves the academic package.
5. The student works through tasks.
6. The extension records events, state, Git commits, metadata, and agent
   interactions.
7. The student exports a submission.
8. The teacher extension imports the submission and reviews code, evolution,
   and evidence.

The system's value depends on the activity package being the shared source of
truth. For that reason, the format must be documented, versioned, and validated.

## 2. Shared Activity Model

An activity is distributed as a ZIP with `manifest.json` at the root or inside a
single container directory. The base structure is:

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
    `-- manifest.sig
```

When imported into the student's workspace, the contents of
`starter/proyecto-base/` are copied to the project root. The full academic
package is preserved in `.vsc4education/`:

```text
student-workspace/
|-- AGENTS.md
|-- src/
|-- package.json
|-- .git/
`-- .vsc4education/
    |-- activity-manifest.json
    |-- activity-configuration.json
    |-- theory/
    |-- tasks/
    |-- agent/
    |   |-- instructions.md
    |   `-- instructions.master.md
    |-- starter/
    |-- signatures/
    `-- contributions/
```

### 2.1 `manifest.json`

The manifest identifies the activity and declares its tasks.

```json
{
  "id": "poo-basico-01",
  "title": "Basic OOP",
  "description": "An introductory practice on classes, encapsulation, and behavior.",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "encapsulation",
      "title": "Encapsulate Animal",
      "description": "Make state private and expose controlled operations.",
      "file": "tasks/task1.md"
    }
  ]
}
```

Activity fields:

| Field | Required | Use |
|---|---:|---|
| `id` | Yes | Stable activity identifier. It must not change between versions of the same activity. |
| `title` | Yes | Visible name for students and teachers. |
| `description` | No | Brief pedagogical summary. |
| `version` | Not in the MVP, required as project policy | Academic package version. It should follow SemVer when possible. |
| `tasks` | Yes | Non-empty task list. |

Task fields:

| Field | Required | Use |
|---|---:|---|
| `id` | Yes | Stable identifier unique within the activity. |
| `title` | Yes | Visible task name. |
| `description` | No | Brief task summary for panels and review. |
| `file` | Not in the MVP, recommended | Relative path to the task Markdown document. |

Identifiers must start with a letter or number and may contain only letters,
numbers, dots, hyphens, and underscores.

### 2.2 Activity Versioning

The activity version coordinates authors, students, and review. The current
student extension preserves `version` when it exists; the teacher extension
should treat it as required when publishing.

Recommended versioning:

- `MAJOR`: changes task structure, IDs, criteria, or starter project in a way
  that is incompatible with earlier submissions.
- `MINOR`: adds optional tasks, theory, resources, or compatible improvements.
- `PATCH`: fixes text, minor errors, or instructions without changing
  assessable requirements.

Compatibility rules:

- The activity `id` must remain stable.
- A task `id` must not be reused for a different prompt.
- If a task changes substantially, the activity version must change and the
  package changelog must document the change.
- Submissions must clearly indicate the `activityId` and `version` they were
  produced against.

## 3. Student Extension Requirements

The student extension prepares the work environment and records the student's
local process.

### 3.1 Activity Loading

It must:

- import activities from a local ZIP;
- import activities from a trusted URL;
- accept `manifest.json` at the root or inside a single container directory;
- validate the minimum manifest fields;
- copy `starter/proyecto-base/` to the selected workspace root;
- preserve the full academic package in `.vsc4education/`;
- write `.vsc4education/activity-manifest.json` as a normalized manifest copy;
- write `.vsc4education/activity-configuration.json` with load date, Git state,
  and repository mode.

### 3.2 Identity And Contributions

It must:

- request institutional identifier, first name, and last name;
- normalize the identifier for use as a contribution directory;
- create `.vsc4education/contributions/<studentId>/`;
- maintain per student `profile.json`, `state.json`, `events.jsonl`,
  `agent-interactions.jsonl`, `AGENTS.generated.md`, `current-task.json`, and
  `task-metadata/`;
- locally bind the workspace to a student through `workspaceState`;
- prevent the extension from accidentally writing into another student's
  contribution.

### 3.3 Task Management

It must:

- show the task list declared in `manifest.tasks`;
- allow a single active task;
- prevent finishing a task that is not active;
- prevent restarting a completed task;
- record `pending`, `active`, and `completed` states;
- create metadata on completion: duration, modified files, save count, initial
  commit, and final commit when Git is available.

### 3.4 Local Evidence

It must record JSONL events per student with a hash chain:

- `activity_loaded`
- `student_registered`
- `student_session_started`
- `task_started`
- `task_finished`
- `active_editor_changed`
- `file_changed`
- `file_saved`
- `file_created`
- `file_deleted`
- `terminal_opened`
- `heartbeat`
- `submission_exported`
- `agents_file_restored`
- `foreign_contribution_modified`

Events must record minimal metadata, not full file contents. The hash chain
helps detect inconsistencies, but must not be presented as a forensic
guarantee.

### 3.5 Git

It must:

- initialize Git if no repository exists and integration is enabled;
- reuse existing repositories without destroying history;
- create a load checkpoint when the repository already has history;
- create commits when tasks start and finish;
- create a final checkpoint before exporting a submission;
- keep working if Git is not available.

### 3.6 AI Agents

It must:

- generate `AGENTS.md` from the activity's canonical instructions;
- preserve a master copy in `.vsc4education/agent/instructions.master.md`;
- add technical instructions for recording interactions in
  `agent-interactions.jsonl`;
- restore `AGENTS.md` and internal instructions if they are modified while the
  extension is active;
- clearly state that it does not use private APIs from ChatGPT, Claude, Codex,
  or Copilot.

### 3.7 Export

It must:

- record `submission_exported`;
- pause automatic tracking during packaging;
- create a final Git checkpoint when appropriate;
- generate a ZIP with the project, `.vsc4education/`, and `.git/` when present;
- use traceable submission names, for example
  `submission-<activityId>-<studentId>-<timestamp>.zip`.

## 4. Teacher Extension Requirements

The teacher extension is the counterpart that creates compatible activities and
reviews submissions generated by students.

### 4.1 Activity Authoring

It must allow teachers to:

- create a new activity from a template;
- edit `manifest.json` through a form and JSON view;
- manage theory in `theory/`;
- manage tasks in `tasks/`;
- associate each manifest task with its Markdown document;
- prepare or select `starter/proyecto-base/`;
- create and edit `agent/instructions.md`;
- maintain a package changelog;
- increment the activity version according to the type of change.

### 4.2 Pre-Publish Validation

It must validate that:

- `manifest.json` is valid JSON;
- `id`, `title`, `version`, and `tasks` exist;
- IDs match the allowed pattern;
- there are no duplicate tasks;
- each `task.file` points to an existing file;
- `agent/instructions.md` exists;
- `starter/proyecto-base/` exists;
- the starter does not contain `.git`, `node_modules`, unnecessary builds, or
  temporary files;
- there are no obvious secrets or credentials;
- agent instructions do not include a direct solution;
- the resulting ZIP has exactly one valid root.

### 4.3 Packaging

It must:

- export a ZIP compatible with the student extension;
- preserve relative paths;
- include `manifest.json`, `theory/`, `tasks/`, `agent/`, `starter/`, and
  optional resources;
- generate or update `signatures/manifest.sig` when cryptographic support
  exists;
- calculate package checksums when formal support is added.

### 4.4 Submission Review

It must be able to import a submission and analyze:

- `activity-manifest.json` and activity version;
- `activity-configuration.json`;
- contributions per student;
- `state.json` and final task state;
- `task-metadata/*.json`;
- `events.jsonl` and hash-chain validity;
- `agent-interactions.jsonl`;
- Git history and diffs by task;
- files changed relative to the starter;
- long heartbeat gaps or temporal inconsistencies;
- modifications in foreign contributions.

Review should help the teacher evaluate process and result. It must not promise
absolute fraud detection.

### 4.5 Teacher Feedback

It must allow feedback associated with evidence:

- comments by task;
- comments by file or diff;
- observations about agent use;
- warnings about inconsistent events;
- rubric or evaluation criteria;
- report export as Markdown, JSON, or PDF.

## 5. Contract Between Extensions

Both extensions must share these rules:

- The activity package is the canonical source before import.
- `.vsc4education/activity-manifest.json` is the canonical source after import.
- Tasks are always referenced by `task.id`, never by position.
- Task and theory files are referenced by relative paths inside the package.
- Each student has an independent contribution in
  `.vsc4education/contributions/<studentId>/`.
- Events are JSON Lines, one entry per line.
- Agent conversations are JSON Lines separate from events.
- Local evidence is review-oriented and advisory, not invulnerable.
- Incompatible format changes must increase a schema version.

## 6. Format Versioning

The MVP does not include an explicit schema-version field. To let both
extensions evolve safely, a future version should introduce one:

```json
{
  "schemaVersion": "1.0.0",
  "id": "poo-basico-01",
  "title": "Basic OOP",
  "version": "1.0.0",
  "tasks": []
}
```

Proposed policy:

- `schemaVersion` describes the technical contract.
- `version` describes the academic activity version.
- The teacher extension must declare which schema version it produces.
- The student extension must declare which schema versions it consumes.
- The teacher extension must warn when a submission uses an unsupported version.

## 7. Minimum Compatibility Criteria

An activity is compatible with the current student extension if:

- the ZIP contains `manifest.json` at the root or inside a single container
  directory;
- `manifest.json` has `id`, `title`, and a non-empty `tasks` list;
- each task has `id` and `title`;
- IDs match the allowed pattern;
- there are no duplicate task IDs;
- `starter/proyecto-base/` exists;
- `agent/instructions.md` exists.

A submission is reviewable by the teacher extension if:

- it contains `.vsc4education/activity-manifest.json`;
- it contains `.vsc4education/activity-configuration.json`;
- it contains at least one contribution in `.vsc4education/contributions/`;
- each contribution has `profile.json`, `state.json`, and `events.jsonl`;
- events can be read line by line as JSON;
- missing Git or agent conversations are treated as missing data, not as fatal
  errors.

## 8. Related Documents

- [Activity format](activity-format.md)
- [Complete activity authoring guide](activity-authoring-guide.md)
- [Event model](events.md)
- [Security, privacy, and limitations](security-limitations.md)
- [Documentation index](README.md)

## 9. Executive Summary

The project should be understood as a two-extension ecosystem around a versioned
activity.

The teacher extension produces activities and reviews submissions. The student
extension consumes activities, supports work, and generates evidence. The bridge
between them must not be the UI or internal implementation, but a documented
file structure: `manifest.json`, academic folders, starter project, agent
instructions, `.vsc4education/`, contributions, events, and metadata.

As long as that contract remains clear and versioned, both extensions can evolve
separately without breaking the full pedagogical workflow.
