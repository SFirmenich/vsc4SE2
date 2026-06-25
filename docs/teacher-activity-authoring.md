# Activity authoring

Open the directory that will be the activity project in VS Code, then run
`Learning Activity Teacher: Open Teacher Panel`. If `manifest.json` is absent,
the panel displays an initialization wizard and creates:

```text
manifest.json
theory/
tasks/
agent/instructions.md
starter/proyecto-base/
rubrics/
signatures/
```

After initialization, files are the source of truth. The panel reads and
summarizes them but does not replace the normal VS Code editor. Buttons open
`manifest.json`, task Markdown, theory, the rubric, and agent instructions as
ordinary files. Saving, creating, renaming, or deleting project files refreshes
the panel automatically.

The panel can create a task file plus its manifest entry, create theory
Markdown, create the initial rubric, show validation state, and export. Export
is enabled only when validation passes.
