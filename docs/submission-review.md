# Submission review

Import a student ZIP with `Learning Activity Teacher: Import Student
Submission`. The archive is extracted under the extension's global storage,
with entry count and uncompressed-size limits.

The review panel exposes student selection, task/event/file filters, timelines,
summary metrics, Git commits, changed files, agent interactions, integrity, the
rubric, and feedback. It never executes student code or installs dependencies.

Feedback is stored under `reviews/<submissionId>/`, outside the imported
project. Export produces a ZIP containing those review JSON files.
