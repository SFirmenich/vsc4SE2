import hashlib
import json
import posixpath
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from django.conf import settings


class ZipValidationError(ValueError):
    pass


@dataclass
class JsonlParseResult:
    rows: list[dict] = field(default_factory=list)
    invalid_lines: list[dict] = field(default_factory=list)


def sha256_file(uploaded_file) -> tuple[str, bytes]:
    uploaded_file.seek(0)
    data = uploaded_file.read()
    uploaded_file.seek(0)
    return hashlib.sha256(data).hexdigest(), data


def _normal_zip_path(name: str) -> str:
    normalized = name.replace("\\", "/")
    if not normalized or normalized.startswith("/"):
        raise ZipValidationError(f"Unsafe archive path: {name}")
    if ":" in PurePosixPath(normalized).parts[0]:
        raise ZipValidationError(f"Unsafe archive path: {name}")
    collapsed = posixpath.normpath(normalized)
    if collapsed == "." or collapsed.startswith("../") or "/../" in collapsed:
        raise ZipValidationError(f"Unsafe archive path: {name}")
    return collapsed


def validate_zip(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > settings.VSC4EDU_MAX_ZIP_ENTRIES:
        raise ZipValidationError("ZIP contains too many entries")
    total_size = 0
    for info in infos:
        _normal_zip_path(info.filename)
        total_size += info.file_size
        if total_size > settings.VSC4EDU_MAX_ZIP_UNCOMPRESSED_BYTES:
            raise ZipValidationError("ZIP uncompressed size exceeds the configured limit")


def build_name_map(zf: zipfile.ZipFile) -> dict[str, str]:
    return {_normal_zip_path(name): name for name in zf.namelist() if not name.endswith("/")}


def candidate_roots(names: list[str]) -> list[str]:
    first_segments = {name.split("/", 1)[0] for name in names if "/" in name}
    roots = [""]
    if len(first_segments) == 1:
        roots.append(next(iter(first_segments)) + "/")
    return roots


def find_file(name_map: dict[str, str], relative_path: str) -> str | None:
    names = list(name_map.keys())
    for root in candidate_roots(names):
        candidate = root + relative_path
        if candidate in name_map:
            return name_map[candidate]
    return None


def find_prefix(name_map: dict[str, str], relative_prefix: str) -> str | None:
    names = list(name_map.keys())
    for root in candidate_roots(names):
        candidate = root + relative_prefix.strip("/") + "/"
        if any(name.startswith(candidate) for name in names):
            return candidate
    return None


def read_json(zf: zipfile.ZipFile, archive_name: str) -> dict:
    try:
        with zf.open(archive_name) as fh:
            value = json.loads(fh.read().decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ZipValidationError(f"Invalid JSON in {archive_name}: {exc}") from exc
    if not isinstance(value, dict):
        raise ZipValidationError(f"Expected JSON object in {archive_name}")
    return value


def read_jsonl(zf: zipfile.ZipFile, archive_name: str) -> JsonlParseResult:
    result = JsonlParseResult()
    with zf.open(archive_name) as fh:
        for line_number, raw_line in enumerate(fh, start=1):
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    result.rows.append(value)
                else:
                    result.invalid_lines.append({"line": line_number, "reason": "not_object"})
            except json.JSONDecodeError as exc:
                result.invalid_lines.append({"line": line_number, "reason": str(exc)})
    return result


def event_counter(events: list[dict]) -> Counter:
    counter = Counter()
    for event in events:
        event_type = event.get("event") or event.get("type")
        if event_type:
            counter[str(event_type)] += 1
    return counter
