# Repository Application

`VSC4EducationRepository` is a local repository application for organizing
courses, groups, activity packages, and student submissions produced by the
VSCode4Education ecosystem.

It is not the source of truth for the portable format. The source of truth
remains the activity ZIP and submission ZIP contract documented in
`activity-format.md`, `events.md`, and `project-and-extensions-spec.md`.

## Purpose

The repository application helps teachers keep a local catalog of:

- courses and course groups;
- imported activity versions;
- original activity ZIP files;
- imported student submission ZIP files;
- extracted process evidence summaries;
- aggregate metrics and comparisons across submissions.

It stores the original ZIP files and extracts normalized metadata for search,
metrics, and comparison. It must not execute student code, install student
dependencies, or mutate the imported ZIP contents.

## Architecture

```text
VSC4EducationRepository/
|-- backend/   Django + Django REST Framework API
|-- frontend/  React + Vite local UI
|-- electron/  Electron desktop shell
`-- scripts/   Development and packaging scripts
```

The backend uses SQLite by default. The desktop build packages the Django
backend as a local executable, builds the React frontend as static assets, and
uses Electron to start the local backend and load the UI.

## Compatibility Role

The repository consumes the same artifacts used by the extensions:

```text
Teacher activity export
-> Repository activity import
-> Student activity import
-> Student submission export
-> Repository submission import
-> Teacher submission import/review
```

Repository import must preserve the core compatibility points:

- activity ZIPs contain `manifest.json` at the ZIP root or inside a single
  container directory;
- `manifest.id`, `manifest.version`, and `manifest.tasks[*].id` identify the
  activity version and task references;
- task IDs are interpreted by stable ID, not array position;
- submission ZIPs contain `.vsc4education/activity-manifest.json`;
- submission ZIPs contain `.vsc4education/activity-configuration.json`;
- submission ZIPs contain at least one
  `.vsc4education/contributions/<studentId>/` directory;
- events and agent interactions are read as JSON Lines;
- missing optional evidence, such as Git history or agent interactions, is
  treated as missing data or a warning rather than a fatal error.

If the activity or submission format changes, Repository import logic must be
checked together with teacher export, student import/export, and teacher
review.

## Data Model

The backend stores these main entities:

- `Course`: academic course owned locally by a teacher or user.
- `CourseGroup`: class group, cohort, term, or commission within a course.
- `LearningActivity`: stable academic activity identity.
- `ActivityVersion`: imported version of a learning activity, including the
  original ZIP, manifest, checksum, and associated groups.
- `ActivityTask`: task metadata extracted from `manifest.tasks`.
- `Student`: normalized student identity from a submission contribution.
- `Submission`: imported student submission ZIP and extracted evidence
  summary.
- `SubmissionTaskState`: per-task state and metadata extracted from
  contribution state and task metadata files.
- `SubmissionEventSummary`: event counts grouped by event type.
- `SubmissionAgentSummary`: aggregate agent interaction counts.
- `ImportWarning`: non-fatal import issues detected in activity or submission
  packages.

Checksums are used to avoid duplicate imports of identical ZIPs. They are a
deduplication aid, not a claim that evidence is tamper-proof.

## Import Behavior

Activity import:

- validates archive safety limits before reading contents;
- finds and parses `manifest.json`;
- requires `id`, `title`, `version`, and a non-empty `tasks` list;
- rejects duplicate task IDs;
- stores the original activity ZIP;
- extracts activity version and task metadata;
- records warnings for missing `starter/proyecto-base` or
  `agent/instructions.md`.

Submission import:

- validates archive safety limits before reading contents;
- requires `.vsc4education/activity-manifest.json`;
- requires `.vsc4education/activity-configuration.json`;
- resolves the target `ActivityVersion` by activity `id` and `version`, unless
  one is explicitly selected;
- imports the first contribution directory if multiple are present and records a
  warning;
- parses `profile.json`, `state.json`, `events.jsonl`, task metadata, and
  `agent-interactions.jsonl` when present;
- stores the original submission ZIP;
- records event, task, Git, agent, and warning summaries.

Corrupt required JSON, unreadable required JSONL, invalid paths, and unsafe
archive entries should produce clear import errors. Invalid lines in optional
or evidence-oriented JSONL files may be recorded as warnings when the rest of
the submission remains reviewable.

## API Surface

Common endpoints:

```text
POST /api/activities/import-zip/
POST /api/submissions/import-zip/
POST /api/activity-versions/{id}/submissions/import-zip/
GET  /api/activity-versions/{id}/metrics/
GET  /api/activity-versions/{id}/comparison/
```

Teacher-integration endpoints:

```text
POST /api/integration/teacher/activity-zip/
POST /api/integration/teacher/submission-zip/
GET  /api/integration/teacher/activities/
GET  /api/integration/teacher/course-groups/
GET  /api/integration/teacher/activity-versions/{id}/submissions/
```

ZIP upload endpoints expect multipart form data with a `zip` file field. Where
supported, `courseGroupId` associates the import with a course group.

## Local Development

Backend:

```powershell
cd VSC4EducationRepository\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Frontend:

```powershell
cd VSC4EducationRepository\frontend
npm install
npm run dev
```

The frontend expects the API at `http://127.0.0.1:8000/api` by default. Set
`VITE_API_BASE` to point it at another backend.

Desktop development:

```powershell
cd VSC4EducationRepository
.\scripts\dev-desktop.ps1
```

Desktop packaging:

```powershell
cd VSC4EducationRepository
.\scripts\build-desktop.ps1
```

Generated desktop build artifacts belong under build output directories such as
`backend/dist/`, `frontend/dist/`, and `electron/dist/`; they should not be
committed.

## Security And Privacy

Repository import treats archive paths as untrusted input. It must validate ZIP
entries before extraction or parsing and keep storage inside the configured
media/database locations.

The application stores student identifiers, event summaries, agent interaction
counts, imported ZIPs, and potentially Git history contained in submissions.
Those files can include personal data and coursework. Access to the local
database, media folder, and desktop app data directory should be limited to the
teacher or authorized reviewer.

Repository metrics are review aids. They should not be presented as definitive
proof of authorship, misconduct, or tamper resistance.
