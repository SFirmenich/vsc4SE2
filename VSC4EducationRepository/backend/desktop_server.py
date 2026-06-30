import os
import sys
from pathlib import Path

from django.core.management import call_command, execute_from_command_line


def user_data_dir() -> Path:
    base = os.environ.get("VSC4EDU_REPOSITORY_DATA_DIR")
    if base:
        return Path(base)
    appdata = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "VSCode4EducationRepository"
    return Path.home() / ".vsc4education-repository"


def main():
    data_dir = user_data_dir()
    media_dir = data_dir / "media"
    data_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "repository.settings")
    os.environ.setdefault("VSC4EDU_REPOSITORY_DB", str(data_dir / "repository.sqlite3"))
    os.environ.setdefault("VSC4EDU_REPOSITORY_MEDIA_ROOT", str(media_dir))
    os.environ.setdefault("VSC4EDU_REPOSITORY_DESKTOP", "1")

    call_command("migrate", interactive=False, verbosity=0)
    execute_from_command_line([sys.argv[0], "runserver", "127.0.0.1:8000", "--noreload"])


if __name__ == "__main__":
    main()
