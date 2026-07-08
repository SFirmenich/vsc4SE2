# Activity authoring

Open the directory that will be the activity project in VS Code, then run
`Learning Activity Teacher: Open Teacher Panel`. If `manifest.json` is absent,
the panel displays an initialization wizard and creates:

```text
manifest.json
theory/
tasks/
imports/
|-- theory/
`-- practice/
AGENTS.md
agent/instructions.md
starter/
resources/
|-- assessment-rubric.schema.json
|-- auto-grading-prompt.md
`-- overall-review-template.md
assessment/
|-- rubrics/
`-- solutions/
rubrics/
signatures/
```

After initialization, files are the source of truth. The panel reads and
summarizes them but does not replace the normal VS Code editor. Buttons open
`manifest.json`, task Markdown, theory, the rubric, and agent instructions as
ordinary files. Saving, creating, renaming, or deleting project files refreshes
the panel automatically.

`imports/` is a local authoring area for previous course material. Teachers can
copy PDFs, DOCX files, slides, old statements, examples, or other source
material into `imports/theory/` and `imports/practice/`. The generated root
`AGENTS.md` explains the activity structure to coding agents so the teacher can
ask an agent to adapt those sources into the canonical `theory/`, `tasks/`,
`agent/`, `assessment/`, `rubrics/`, or `starter/` files. Files in `starter/`
are copied into the student's `src/` folder when the activity is imported.

`assessment/rubrics/<taskId>.yml` and `assessment/solutions/<taskId>.md` are
private teacher material. They are included in the teacher package ZIP and
excluded from the student activity ZIP. Public acceptance criteria belong in
`manifest.tasks[*].acceptanceCriteria`. The generated
`resources/assessment-rubric.schema.json` file describes the YAML shape for
agents and editor tooling. The generated auto-grading prompt and overall-review
template define reusable teacher-side agent review material and are included in
the teacher package ZIP.

The panel can create a task file plus its manifest entry, create theory
Markdown, create the initial per-task assessment rubric and solution, show
validation state, and export. Export is enabled only when validation passes.
`imports/`, `assessment/`, `resources/`, legacy `rubrics/`, and the root
`AGENTS.md` are authoring aids and are not included in the exported student
activity ZIP.
