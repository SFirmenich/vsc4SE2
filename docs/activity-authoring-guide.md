# Complete Guide To Creating A Learning Activity

This document explains how to prepare, organize, validate, and package an
activity compatible with **Learning Activity Tracker - Student**.

The guide describes the format currently implemented by the extension. It does
not yet define a full shared metamodel with the teacher extension.

Complementary documentation:

- [Technical activity format](activity-format.md)
- [Events and evidence model](events.md)
- [Security, privacy, and limitations](security-limitations.md)
- [Student extension README](../VSC4EducationStudents/README.md)

## 1. Activity Goal

A learning activity combines:

- theoretical material;
- a task list;
- a starter project for the student;
- instructions for AI agents;
- optional resources;
- a structured definition in `manifest.json`.

The activity is distributed as a ZIP file. The student imports it from VS Code
and selects a working directory.

The extension:

1. Copies the starter project into the selected directory.
2. Preserves the academic package inside `.vsc4education/`.
3. Requests the student's identity.
4. Creates an individual contribution space.
5. Configures or reuses the Git repository.
6. Records tasks, events, commits, and agent interactions.

## 2. Package Structure

The recommended structure is:

```text
my-activity/
|-- manifest.json
|-- theory/
|   `-- theory.md
|-- tasks/
|   |-- task1.md
|   |-- task2.md
|   `-- task3.md
|-- agent/
|   `-- instructions.md
|-- starter/
|   |-- Animal.ts
|   `-- ...
`-- signatures/
    `-- manifest.sig
```

The ZIP may contain these elements directly at its root or inside a single
container directory.

Teacher source projects also contain private assessment files:

```text
assessment/
|-- rubrics/
|   `-- <taskId>.yml
`-- solutions/
    `-- <taskId>.md
resources/
`-- assessment-rubric.schema.json
```

These files are not distributed to students. They are used by the teacher
extension and teacher-side agents during review. The local schema in
`resources/assessment-rubric.schema.json` supports editor validation and agent
guidance. The YAML format is documented in
[Assessment rubric YAML](assessment-rubrics.md).

Valid examples:

```text
activity.zip
`-- manifest.json
```

```text
activity.zip
`-- my-activity/
    `-- manifest.json
```

There must not be multiple candidate directories with different
`manifest.json` files.

## 3. `manifest.json`

`manifest.json` identifies the activity and declares the available tasks.

Example:

```json
{
  "id": "poo-basico-01",
  "title": "Basic OOP",
  "description": "Introductory practice on classes and encapsulation.",
  "version": "1.0.0",
  "tasks": [
    {
      "id": "encapsulation",
      "title": "Encapsulate Animal",
      "description": "Protect internal state and expose controlled operations.",
      "file": "tasks/task1.md"
    },
    {
      "id": "behavior",
      "title": "Add behavior",
      "description": "Implement the main domain operations.",
      "file": "tasks/task2.md"
    }
  ]
}
```

### Activity Fields

| Field | Required | Description |
|---|---:|---|
| `id` | Yes | Stable and unique activity identifier. |
| `title` | Yes | Name visible to the student. |
| `description` | No | Summary shown in the panel. |
| `version` | No | Academic package version. Semantic versioning is recommended. |
| `tasks` | Yes | Non-empty task list. |

### Task Fields

| Field | Required | Description |
|---|---:|---|
| `id` | Yes | Stable identifier unique within the activity. |
| `title` | Yes | Title visible in the panel. |
| `description` | No | Brief task summary. |
| `file` | No | Relative path to the detailed task document. |

Identifiers may contain only:

```text
letters, numbers, dots, hyphens, and underscores
```

Valid examples:

```text
task-01
encapsulation
phase_1.design
```

Invalid examples:

```text
task 01
../other-folder
task/01
```

Task identifiers cannot be repeated.

## 4. Theoretical Material

The `theory/` directory contains the conceptual material needed by the student.

Recommended practices:

- Use Markdown.
- Split long documents by topic.
- Include conceptual examples without giving away the exact solution.
- Reference concepts used by the tasks.
- Include bibliography or external resources when appropriate.

Example:

```text
theory/
|-- introduction.md
|-- encapsulation.md
`-- testing.md
```

AI agents are instructed to consult this directory before guiding the student.

## 5. Task Definitions

The `tasks/` directory contains the full description of each task.

A task document should include:

1. Goal.
2. Context.
3. Requirements.
4. Constraints.
5. Expected result.
6. Evidence the student should produce.
7. Completion criteria.

Example:

```markdown
# Task: encapsulation

## Goal

Protect the internal state of the `Animal` class.

## Requirements

- The name cannot be empty.
- Energy cannot be negative.
- State must not be changed directly from outside the class.

## Completion Criteria

- The project compiles.
- Invariants are preserved.
- The student can justify their decisions.
```

In the MVP, the extension shows `title` and `description` from the manifest. The
`file` field documents the relationship with the Markdown file, although some
student-side flows may not validate automatically that the file exists.

## 6. Starter Project

The project the student receives must be located at:

```text
starter/
```

All of its contents are copied to the `src/` directory in the working
workspace.

For example:

```text
starter/Animal.ts
```

becomes:

```text
student-project/src/Animal.ts
```

The starter may include:

- incomplete source code;
- language configuration;
- dependencies;
- build scripts;
- partial tests;
- a technical README for the project;
- resources needed to run the solution.

Avoid:

- including a complete solution;
- including secrets or credentials;
- depending on absolute paths from the teacher's machine;
- including `node_modules`, build outputs, or temporary files;
- including a `.git` directory inside `starter/`.

Before packaging, the teacher should copy `starter/` to a clean temporary
directory and verify that the source files are ready for the student workspace.

## 7. Instructions For AI Agents

The following file is required for the intended workflow:

```text
agent/instructions.md
```

Its content defines how Codex, Claude, Copilot, or other agents that read
`AGENTS.md` should behave.

These instructions should:

- forbid the agent from solving the activity;
- allow only pedagogical guidance;
- require the agent to consult theory, tasks, and state;
- define the allowed comment format;
- prevent generation of complete tests or implementations.

Reduced example:

```markdown
# AGENTS.md

## Agent Role

Act as a pedagogical reviewer. Do not implement the solution.

## Forbidden

- Completing functions or classes.
- Rewriting the student's code.
- Creating tests that solve the task.

## Allowed

- Adding pedagogical comments.
- Asking questions.
- Pointing out risks and concepts to review.

## Required Format

// AI-REVIEW [type] [severity] [task-id]:
// Observation: ...
// Pedagogical question: ...
// Conceptual suggestion: ...
// Expected student evidence: ...
```

During import and student registration, the extension:

1. Preserves the base instructions.
2. Adds technical instructions for recording the conversation.
3. Generates `AGENTS.md` at the root.
4. Protects `AGENTS.md` and restores its content while the extension is active.
5. Adjusts state and interaction paths to the active student's contribution.

The full example is available at:

[examples/poo-basico-01/agent/instructions.md](../VSC4EducationStudents/examples/poo-basico-01/agent/instructions.md)

## 8. Signatures

The `signatures/` directory is optional in the MVP.

It may contain:

```text
signatures/manifest.sig
```

The extension currently preserves this file, but it does not validate a
cryptographic signature. It must not be used as a guarantee of authenticity or
integrity.

## 9. Preparing The Source Directory

Before creating the ZIP, check that:

- `manifest.json` is valid JSON;
- at least one task exists;
- identifiers are unique;
- each `file` field points to the correct document;
- `agent/instructions.md` exists;
- `starter/` exists;
- the starter project builds in a clean directory;
- no installed dependencies or temporary files are included;
- there are no secrets, tokens, or personal data;
- agent instructions do not contain solutions.
- each task has a private assessment rubric and official solution.

## 10. Creating The ZIP

The repository includes an example activity:

```text
examples/poo-basico-01/
```

To package it:

```powershell
npm run example:zip
```

This generates:

```text
examples/poo-basico-01.zip
```

The script is:

[scripts/create-example-zip.js](../VSC4EducationStudents/scripts/create-example-zip.js)

For another activity, the same pattern can be reused:

```javascript
const AdmZip = require('adm-zip');

const zip = new AdmZip();
zip.addLocalFolder('path/to/my-activity');
zip.writeZip('my-activity.zip');
```

Do not add the wrong parent directory to the ZIP if that creates multiple
container levels. The extension accepts either a direct root or one container
directory.

## 11. Testing The Package

To test an activity:

1. Run the extension with `F5`.
2. Run `Learning Activity: Load Activity from ZIP`.
3. Select the ZIP.
4. Select a temporary folder.
5. Register a test student.
6. Open `Learning Activity: Open Student Panel`.
7. Start a task.
8. Modify and save a file.
9. Finish the task.
10. Export the submission.

Check that:

- the starter was copied into `src/`;
- the full package was preserved in `.vsc4education/`;
- `AGENTS.md` exists;
- the student's contribution exists;
- events are chained;
- Git commits have the expected messages;
- the submission ZIP contains the complete project.

## 12. Import Result

After import and student registration:

```text
student-project/
|-- AGENTS.md
|-- src/
|-- package.json
|-- .git/
`-- .vsc4education/
    |-- manifest.json
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
        `-- student-001/
            |-- profile.json
            |-- state.json
            |-- events.jsonl
            |-- agent-interactions.jsonl
            |-- AGENTS.generated.md
            |-- current-task.json
            `-- task-metadata/
```

`current-task.json` only exists while a task is active.

## 13. Identity And Contributions

Before working, the student provides:

- institutional identifier;
- first name;
- last name.

The normalized identifier is used as a directory:

```text
.vsc4education/contributions/<studentId>/
```

Each contribution independently maintains:

- profile;
- task state;
- event hash chain;
- task metadata;
- agent interactions;
- dynamic context.

A local VS Code installation is bound to one student for that workspace. This
separation is not equivalent to invulnerable filesystem permissions; see
[security-limitations.md](security-limitations.md).

## 14. Git Management

The activity can be loaded in different situations.

### Folder Without A Repository

The extension:

1. Runs `git init`.
2. Adds the contents.
3. Creates `Initial activity state`.

### Existing Repository Without Commits

The extension reuses the repository and creates its first commit with the
initial state.

### Existing Repository With History

The extension preserves the history and creates:

```text
Checkpoint: Activity loaded
```

### Activity Opened Later

When a project already contains:

```text
.vsc4education/activity-manifest.json
```

the extension recovers the activity and local contribution without creating
another load commit.

Student-associated commits include the student identifier:

```text
[student-001] Task started: encapsulation
[student-001] Task completed: encapsulation
[student-001] Checkpoint: Submission export
```

## 15. Events And Evidence

Each student has:

```text
.vsc4education/contributions/<studentId>/events.jsonl
```

Events include:

- student identity;
- timestamp;
- event type;
- active task;
- minimal metadata;
- previous hash;
- current hash.

Full file contents are not stored.

The detailed specification is in [events.md](events.md).

## 16. Agent Interactions

Generated instructions ask the agent to record each message in:

```text
.vsc4education/contributions/<studentId>/agent-interactions.jsonl
```

Format:

```json
{"timestamp":"2026-06-11T12:00:00.000Z","actor":"student","message":"Question"}
{"timestamp":"2026-06-11T12:00:01.000Z","actor":"agent","agent":"copilot","message":"Answer"}
```

When `actor` is `agent`, the `agent` field must be:

- `chatGPT`
- `claude`
- `copilot`

The extension does not use private APIs to capture conversations. Recording
depends on agent compliance.

## 17. Submission Export

Before generating the ZIP, the extension:

1. Restores `AGENTS.md` if necessary.
2. Records `submission_exported`.
3. Pauses automatic events.
4. Runs `git add .`.
5. Creates the final checkpoint.
6. Generates the full ZIP.

Typical name:

```text
submission-<activityId>-<studentId>-<timestamp>.zip
```

The submission includes the project, `.vsc4education`, and `.git` if present.

## 18. Common Errors

### The ZIP Does Not Contain `manifest.json`

Check that it is at the root or inside a single container directory.

### The Manifest Has No Tasks

`tasks` must be a non-empty list.

### Invalid Identifiers

Do not use spaces, slashes, or relative paths in `id`.

### `AGENTS.md` Is Not Generated

Check that `agent/instructions.md` exists and that the student has been
registered.

### The Starter Appears In The Wrong Folder

The files that should become editable source files must be directly inside
`starter/`, so they import into `src/`.

### The Project Does Not Compile After Import

Test the starter outside the package and include all required configuration
files.

### The Agent Does Not Record Conversations

The extension can only instruct the agent. It cannot force external tools
through private APIs.

### Git Does Not Create Commits

Check that Git is installed. The extension configures a local identity when
needed, but allows work to continue without Git integration when Git is not
available.

## 19. Final Author Checklist

Before distributing an activity:

- [ ] The activity identifier is stable.
- [ ] The version was updated.
- [ ] The title and description are clear.
- [ ] All tasks have unique identifiers.
- [ ] Each task has a Markdown document.
- [ ] Theory covers the required concepts.
- [ ] The starter does not contain the solution.
- [ ] The starter builds from a clean directory.
- [ ] `agent/instructions.md` correctly limits agents.
- [ ] Each task has `assessment/rubrics/<taskId>.yml`.
- [ ] Each task has `assessment/solutions/<taskId>.md`.
- [ ] Assessment task scores sum to 100.
- [ ] There are no secrets or personal data.
- [ ] The ZIP has the expected structure.
- [ ] Import was tested with a new Git repository.
- [ ] Import was tested with an existing repository.
- [ ] A task could be started and finished.
- [ ] Events and metadata were generated.
- [ ] A submission could be exported.

## 20. Reference Activity

The reference implementation is:

[examples/poo-basico-01](../VSC4EducationStudents/examples/poo-basico-01)

It is a good starting point. Copy it and replace:

- `manifest.json`;
- the contents of `theory/`;
- the contents of `tasks/`;
- `agent/instructions.md`;
- the source files in `starter/`.

Keep the folder structure until a formal shared metamodel version exists.
