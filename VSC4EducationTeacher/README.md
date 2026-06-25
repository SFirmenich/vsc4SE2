# Learning Activity Tracker - Teacher

VS Code extension for authoring learning activities and reviewing student
submissions compatible with **Learning Activity Tracker - Student**.

## MVP features

- Initialize an activity directly in the currently open VS Code project.
- Use one Teacher Panel to inspect project state, validate, and export.
- Edit manifests, tasks, theory, rubrics, agent instructions, and starter code
  with the normal VS Code file editors.
- Validate manifests, references, cycles, paths, rubrics, and package contents.
- Export student-compatible ZIP packages with optional SHA-256 file hashes.
- Safely import student ZIP submissions into extension global storage.
- Review timelines, contribution summaries, agent interactions, Git commits,
  changed files, and event-chain integrity.
- Save rubric feedback outside the imported submission and export it as ZIP.

## Run with F5

1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run compile` and `npm test`.
4. Press `F5` and select **Run Learning Activity Tracker - Teacher**.
5. Open the project directory that will contain the activity.
6. Run `Learning Activity Teacher: Open Teacher Panel`.

The open workspace folder and its files are the activity source of truth. The
panel refreshes when files are saved, created, renamed, or deleted. Imported
submissions and reviews use `globalStorageUri`; large submissions are never
stored in `globalState`.

## Commands

- `teacherActivity.openPanel`
- `teacherSubmission.import`
- `teacherSubmission.openReview`
- `teacherSubmission.exportFeedback`

Further documentation is available in the central workspace documentation:
`../docs/README.md`, `../docs/teacher-activity-authoring.md`,
`../docs/submission-review.md`, `../docs/rubrics.md`, `../docs/teacher-security-limitations.md`, and `../docs/teacher-student-compatibility.md`.
