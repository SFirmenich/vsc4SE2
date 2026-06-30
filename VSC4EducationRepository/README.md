# VSCode4Education Repository

Local repository for VSCode4Education activities and student submissions.

The app stores the original ZIP files and extracts normalized metadata for
searching, metrics, and comparison. It does not execute student code or install
student dependencies.

## Structure

- `backend/`: Django + Django REST Framework API using SQLite by default.
- `frontend/`: React + Vite local UI.

## Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Useful API endpoints:

- `POST /api/activities/import-zip/`
- `POST /api/activity-versions/{id}/submissions/import-zip/`
- `POST /api/integration/teacher/activity-zip/`
- `POST /api/integration/teacher/submission-zip/`
- `GET /api/activity-versions/{id}/metrics/`
- `GET /api/activity-versions/{id}/comparison/`

All ZIP upload endpoints expect multipart form data with a `zip` file field.

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

By default the UI expects the backend at `http://127.0.0.1:8000/api`.
Override it with `VITE_API_BASE` if needed.

## Desktop App

The desktop build packages:

- the Django backend as a local executable with PyInstaller;
- the React frontend as static Vite assets;
- an Electron shell that starts the backend and loads the UI.

The packaged app stores SQLite and uploaded ZIP/media files in the user's app
data directory, not inside the installation folder.

### Development Desktop Run

```powershell
cd VSC4EducationRepository
.\scripts\dev-desktop.ps1
```

This starts the backend, Vite, and Electron in development mode.

### Production Desktop Build

```powershell
cd VSC4EducationRepository
.\scripts\build-desktop.ps1
```

The installer/portable build is generated under:

```text
electron/dist/
```

The build script performs these steps:

1. installs backend Python dependencies;
2. installs PyInstaller;
3. builds `backend/dist/vsc4education-repository-backend/`;
4. builds `frontend/dist/`;
5. runs `electron-builder`.

Electron integration endpoints continue to use the local API:

```text
http://127.0.0.1:8000/api
```
