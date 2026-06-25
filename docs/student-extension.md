# Learning Activity Tracker - Student Overview

This document describes the general idea of the **Learning Activity Tracker -
Student** extension as a tool for working with programming learning packages,
supporting the student's process, and generating a submission that teachers can
review.

For operational details about building a compatible package, see the
[complete activity authoring guide](activity-authoring-guide.md). For technical
details, see [activity-format.md](activity-format.md),
[events.md](events.md), and [security-limitations.md](security-limitations.md).

## Core Idea

The extension turns a programming practice into a **learning package importable
by VS Code**.

A learning package contains:

- the activity definition;
- the required theory;
- the tasks the student must complete;
- a starter project;
- instructions for AI agents;
- optional supporting files.

The goal is not only to deliver initial code, but to create a working
environment where the student's process is supported and documented.

## Workflow

The expected flow is:

1. The teacher prepares a learning activity.
2. The teacher exports the activity as a ZIP.
3. The student imports the ZIP from VS Code.
4. The extension prepares the working project.
5. The student registers their identity.
6. The student starts and finishes tasks from the panel.
7. The extension records events, commits, metadata, and interactions.
8. The student exports a submission.
9. The teacher reviews the project, evolution, and evidence.

## Learning Package

An activity is distributed as a ZIP with a structure like:

```text
activity.zip
|-- manifest.json
|-- theory/
|-- tasks/
|-- agent/
|   `-- instructions.md
|-- starter/
|   `-- proyecto-base/
`-- signatures/
```

`manifest.json` defines the activity and its tasks. The
`starter/proyecto-base` directory contains the initial project that will be
copied to the root of the student's workspace.

When the activity is imported, the full package is preserved inside:

```text
.vsc4education/
```

This keeps the original academic material, tasks, theory, and agent
instructions available inside the student project.

## Student Project

After import, the workspace is organized so the student works on the real
project at the root:

```text
student-project/
|-- src/
|-- package.json
|-- AGENTS.md
|-- .git/
`-- .vsc4education/
```

The code the student must modify lives in the normal project, such as `src/`.
Academic material and evidence live in `.vsc4education/`.

## Identity And Contributions

Before starting a task, the student must register with:

- institutional identifier;
- first name;
- last name.

The extension creates an individual workspace:

```text
.vsc4education/contributions/<studentId>/
```

Everything related to that student is stored in that directory:

```text
profile.json
state.json
events.jsonl
agent-interactions.jsonl
AGENTS.generated.md
current-task.json
task-metadata/
```

This allows the same repository to contain separate evidence for multiple
students, which is useful in group practices or shared projects.

The extension locally binds the VS Code installation to one student for that
workspace. This is not an operating-system security boundary, but it prevents
the extension itself from accidentally writing evidence into another
classmate's contribution.

## Process Support

The extension supports the student through:

- a task panel;
- task states: `pending`, `active`, and `completed`;
- buttons to start and finish tasks;
- automatic event logging;
- periodic heartbeats;
- automatic Git commits;
- generated context for agents;
- final submission export.

The intention is for the student to work normally inside VS Code without
manually managing evidence files.

## Events And Evidence

Each student has their own log:

```text
.vsc4education/contributions/<studentId>/events.jsonl
```

Events record actions such as:

- activity loaded;
- student registered;
- session started;
- task started;
- file edited;
- file saved;
- terminal opened;
- task finished;
- submission exported;
- `AGENTS.md` restored;
- modification detected in another contribution.

Each event is stored as one JSON line and participates in a hash chain. This
helps detect accidental alterations or inconsistencies in the sequence.

The extension does not store full file contents. It records paths, event type,
timestamps, and minimal metadata.

## Git

The extension uses Git to support project evolution.

It handles several scenarios:

- If no repository exists, it initializes one.
- If a repository exists without commits, it creates the first commit.
- If a repository exists with history, it preserves the history and adds a
  checkpoint.
- If an already installed activity is opened, it resumes the session without
  creating another load commit.

During work it generates commits such as:

```text
[studentId] Task started: <taskId>
[studentId] Task completed: <taskId>
[studentId] Checkpoint: Submission export
```

This allows reviewers to inspect code evolution alongside evidence recorded in
`.vsc4education`.

## Role Of AI Agents

The extension does not integrate with private APIs from Codex, ChatGPT, Claude,
or Copilot.

Agent integration happens through workspace files.

The learning package includes:

```text
agent/instructions.md
```

When the activity is imported, the extension generates and protects:

```text
AGENTS.md
```

This file tells agents how they should behave inside the project.

The expected agent role is pedagogical:

- Do not solve the practice.
- Do not write functional solution code.
- Do not replace student implementations.
- Do not create complete tests that solve the task.
- It may add pedagogical comments.
- It may point out risks, questions, or concepts to review.
- It may propose strategies in natural language.

The instructions also ask the agent to record the conversation in:

```text
.vsc4education/contributions/<studentId>/agent-interactions.jsonl
```

Each entry must include:

- timestamp;
- actor;
- message;
- agent provider when relevant: `chatGPT`, `claude`, or `copilot`.

Example:

```json
{"timestamp":"2026-06-11T12:00:00.000Z","actor":"student","message":"I do not understand this task"}
{"timestamp":"2026-06-11T12:00:01.000Z","actor":"agent","agent":"copilot","message":"First review which fields should be private."}
```

This log depends on the agent following the instructions. The extension cannot
read private conversations from external tools.

## AGENTS.md Protection

`AGENTS.md` is an important part of the pedagogical contract.

While the extension is active:

- if `AGENTS.md` is modified, it is restored;
- if it is deleted, it is recreated;
- if the internal instructions file is modified, it is also restored from the
  master copy.

The canonical copy is preserved in:

```text
.vsc4education/agent/instructions.master.md
```

This protection works within the normal capabilities of a VS Code extension. It
does not prevent a user with filesystem access from modifying files while the
extension is inactive.

## Exported Submission

On export, the extension generates a submission ZIP.

Before creating the ZIP, it:

1. Restores `AGENTS.md` if necessary.
2. Records the `submission_exported` event.
3. Pauses automatic events to avoid noise during packaging.
4. Runs `git add .`.
5. Creates a final checkpoint.
6. Generates the ZIP file.

The suggested name is:

```text
submission-<activityId>-<studentId>-<timestamp>.zip
```

The submission includes:

- the full project;
- source code;
- `.git` if present;
- `.vsc4education`;
- student contributions present in the workspace;
- events, metadata, and recorded conversations.

## Teacher Review

Although this extension is student-facing, the submission is prepared so a
teacher tool can analyze:

- repository evolution;
- commits and diffs;
- started and finished tasks;
- approximate time spans;
- modified files;
- events per student;
- agent interactions;
- task metadata;
- possible activity gaps;
- hash-chain inconsistencies.

The submission is not intended to be forensic proof. It is a source of local
evidence to support teacher review.

## Important Limitations

The extension should be understood as a support and evidence tool, not an
anti-cheating system.

Main limitations:

- The student controls their machine.
- The student can modify files manually.
- The extension only observes while it is active.
- Agent logs depend on the agent obeying `AGENTS.md`.
- Hashes detect inconsistencies, but do not guarantee absolute authenticity.
- Git helps reconstruct evolution, but is also under local control.

See [security-limitations.md](security-limitations.md) for more detail.

## Relationship With A Teacher Extension

A teacher extension can use these same files to:

- create activities visually;
- export compatible packages;
- import submissions;
- review timelines;
- view commits and diffs;
- navigate agent conversations;
- verify hash chains;
- compare initial and final state;
- associate feedback with evidence.

For now, the format stays pragmatic and documented, without introducing a full
formal metamodel yet.

## Summary

Learning Activity Tracker - Student turns a programming practice into an
instrumented learning environment.

Its main value is combining:

- starter project;
- explicit tasks;
- theory;
- rules for AI agents;
- activity logging;
- per-student evidence;
- Git evolution;
- reviewable export.

The extension aims to let the student work normally in VS Code while the process
is documented in a way that is useful for learning, monitoring, and teacher
review.
