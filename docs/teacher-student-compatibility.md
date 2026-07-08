# Student extension compatibility

Exported activity ZIP files keep `manifest.json` at the archive root and retain
the standard `theory/`, `tasks/`, `agent/`, `starter/`, and `signatures/`
directories.

Teacher-only assessment material under `assessment/` and legacy private
`rubrics/` are excluded from the student activity ZIP. Teacher-only generic
review resources under `resources/` are also excluded from the student activity
ZIP. They remain available in teacher packages used for review.

Only `id`, `title`, and a non-empty task list with task `id` and `title` are
required. Teacher-only task fields are optional, so consumers that understand
the base format can ignore acceptance criteria and expected evidence.

`signatures/hashes.json` is explicitly marked with `"signed": false`. The
extension never claims that hashes constitute a real digital signature.

Submission import locates
`.vsc4education/activity-manifest.json` recursively and reads contributions
under `.vsc4education/contributions/<studentId>/`.

The repository application follows the same portable-file contract when it
imports teacher activity ZIPs and student submission ZIPs. Repository database
rows, metrics, and comparisons are derived from those archives; they do not
replace the activity or submission ZIP as the compatibility artifact.
