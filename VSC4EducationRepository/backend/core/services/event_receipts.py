import base64
import hashlib
import hmac
import json
import secrets
from datetime import timezone as datetime_timezone
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, PrivateFormat, NoEncryption

from core.models import ActivityVersion, CourseGroup, EventIngestionSession, EventIngestionToken, EventReceipt, Student
from core.services.safe_zip import ZipValidationError


TOKEN_PREFIX = "vsc4e_ing_"
SESSION_TOKEN_PREFIX = "vsc4e_sess_"
SIGNING_KEY_ID = getattr(settings, "VSC4EDU_EVENT_SIGNING_KEY_ID", "repo-local-2026-01")
PRIVATE_KEY_PATH = Path(getattr(settings, "VSC4EDU_EVENT_SIGNING_PRIVATE_KEY", Path(settings.MEDIA_ROOT) / "repository-private" / "event-signing-key.json"))


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _from_b64url(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def token_hash(token: str) -> str:
    return sha256_text(token)


def new_token(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(32)


def _private_key() -> Ed25519PrivateKey:
    if PRIVATE_KEY_PATH.exists():
        value = json.loads(PRIVATE_KEY_PATH.read_text(encoding="utf-8"))
        return Ed25519PrivateKey.from_private_bytes(_from_b64url(value["d"]))
    PRIVATE_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    private_bytes = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    jwk = {
        "kty": "OKP",
        "crv": "Ed25519",
        "kid": SIGNING_KEY_ID,
        "d": _b64url(private_bytes),
        "x": _b64url(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)),
    }
    PRIVATE_KEY_PATH.write_text(json.dumps(jwk, indent=2), encoding="utf-8")
    return key


def public_signing_key() -> dict:
    public_bytes = _private_key().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return {
        "kty": "OKP",
        "crv": "Ed25519",
        "kid": SIGNING_KEY_ID,
        "x": _b64url(public_bytes),
    }


def public_key_fingerprint(jwk: dict | None = None) -> str:
    public = jwk or public_signing_key()
    return sha256_text(canonical_json(public))


def sign_payload(payload: dict) -> str:
    return base64.b64encode(_private_key().sign(canonical_json(payload).encode("utf-8"))).decode("ascii")


def verify_payload_signature(public_jwk: dict, payload: dict, signature: str) -> bool:
    try:
        public = Ed25519PublicKey.from_public_bytes(_from_b64url(public_jwk["x"]))
        public.verify(base64.b64decode(signature.encode("ascii")), canonical_json(payload).encode("utf-8"))
        return True
    except Exception:
        return False


def issue_ingestion_token(activity_version: ActivityVersion, course_group: CourseGroup | None = None, name: str = "") -> tuple[EventIngestionToken, str]:
    token = new_token(TOKEN_PREFIX)
    model = EventIngestionToken.objects.create(
        activity_version=activity_version,
        course_group=course_group,
        name=name.strip(),
        token_hash=token_hash(token),
    )
    return model, token


def authenticate_ingestion_token(raw_token: str, activity_version: ActivityVersion) -> EventIngestionToken:
    now = timezone.now()
    digest = token_hash(raw_token or "")
    for token in EventIngestionToken.objects.filter(activity_version=activity_version, revoked_at__isnull=True):
        if token.expires_at and token.expires_at <= now:
            continue
        if hmac.compare_digest(token.token_hash, digest):
            return token
    raise ZipValidationError("Invalid event ingestion token")


def authenticate_session(raw_token: str, session: EventIngestionSession) -> None:
    if session.closed_at:
        raise ZipValidationError("Event ingestion session is closed")
    if not hmac.compare_digest(session.session_token_hash, token_hash(raw_token or "")):
        raise ZipValidationError("Invalid event ingestion session token")


def resolve_activity_version(activity_id: str, version: str | None) -> ActivityVersion:
    try:
        return ActivityVersion.objects.get(activity__activity_id=activity_id, version=version or "")
    except ActivityVersion.DoesNotExist as exc:
        raise ZipValidationError(f"No ActivityVersion found for {activity_id}@{version or ''}") from exc


def parse_client_timestamp(value: str | None):
    if not value:
        return None
    parsed = parse_datetime(value)
    if parsed and timezone.is_naive(parsed):
        return timezone.make_aware(parsed, datetime_timezone.utc)
    return parsed


def create_or_get_session(data: dict, ingestion_token: EventIngestionToken) -> tuple[EventIngestionSession, str]:
    student, _ = Student.objects.get_or_create(
        institutional_id=data["studentId"],
        defaults={"display_name": data.get("displayName", "") or data["studentId"]},
    )
    session_token = new_token(SESSION_TOKEN_PREFIX)
    session, created = EventIngestionSession.objects.get_or_create(
        activity_version=ingestion_token.activity_version,
        student=student,
        contribution_id=data["contributionId"],
        client_session_id=data["clientSessionId"],
        defaults={
            "course_group": ingestion_token.course_group,
            "session_token_hash": token_hash(session_token),
        },
    )
    if not created:
        session_token = ""
    return session, session_token


def create_receipts(session: EventIngestionSession, events: list[dict]) -> list[EventReceipt]:
    receipts = []
    next_sequence = session.receipts.count() + 1
    for index, event in enumerate(events):
        payload = {
            "schema": "vsc4e.event.receipt.v1",
            "activityId": session.activity_version.activity.activity_id,
            "version": session.activity_version.version,
            "studentId": session.student.institutional_id,
            "contributionId": session.contribution_id,
            "clientSessionId": session.client_session_id,
            "eventId": event["id"],
            "eventHash": event["hash"],
            "previousHash": event.get("previousHash"),
            "clientTimestamp": event.get("timestamp"),
            "envelopeSha256": event["envelopeSha256"],
            "sequence": next_sequence + index,
            "serverReceivedAt": timezone.now().isoformat().replace("+00:00", "Z"),
        }
        receipt, created = EventReceipt.objects.get_or_create(
            session=session,
            event_id=event["id"],
            defaults={
                "sequence": payload["sequence"],
                "event_hash": event["hash"],
                "previous_hash": event.get("previousHash") or "",
                "client_timestamp": parse_client_timestamp(event.get("timestamp")),
                "envelope_sha256": event["envelopeSha256"],
                "signing_key_id": SIGNING_KEY_ID,
                "payload": payload,
                "signature": sign_payload(payload),
            },
        )
        receipts.append(receipt)
        session.last_event_hash = event["hash"]
    session.save(update_fields=["last_event_hash"])
    return receipts
