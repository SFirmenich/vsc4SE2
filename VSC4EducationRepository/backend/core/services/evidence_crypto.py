import base64
import json
import zipfile

from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes


PRIVATE_KEY_PATH = "teacher-private/evidence-private-key.jwk"
ENCRYPTED_EVENT_SCHEMA = "vsc4e.event.encrypted.v1"


def _b64url_int(value: str) -> int:
    padding_length = (-len(value)) % 4
    raw = base64.urlsafe_b64decode((value + ("=" * padding_length)).encode("ascii"))
    return int.from_bytes(raw, "big")


def _b64(value: str) -> bytes:
    return base64.b64decode(value.encode("ascii"))


def private_key_from_jwk(jwk: dict):
    public_numbers = rsa.RSAPublicNumbers(
        e=_b64url_int(jwk["e"]),
        n=_b64url_int(jwk["n"]),
    )
    private_numbers = rsa.RSAPrivateNumbers(
        p=_b64url_int(jwk["p"]),
        q=_b64url_int(jwk["q"]),
        d=_b64url_int(jwk["d"]),
        dmp1=_b64url_int(jwk["dp"]),
        dmq1=_b64url_int(jwk["dq"]),
        iqmp=_b64url_int(jwk["qi"]),
        public_numbers=public_numbers,
    )
    return private_numbers.private_key()


def read_private_key_from_activity(activity_version):
    if not activity_version or not activity_version.original_zip:
        return None
    try:
        with zipfile.ZipFile(activity_version.original_zip.path) as zf:
            names = {name.replace("\\", "/"): name for name in zf.namelist()}
            archive_name = names.get(PRIVATE_KEY_PATH)
            if not archive_name:
                matches = [name for key, name in names.items() if key.endswith("/" + PRIVATE_KEY_PATH)]
                archive_name = matches[0] if matches else None
            if not archive_name:
                return None
            with zf.open(archive_name) as fh:
                jwk = json.loads(fh.read().decode("utf-8"))
            return private_key_from_jwk(jwk)
    except Exception:
        return None


def decrypt_payload(payload: dict, private_key) -> dict:
    content_key = private_key.decrypt(
        _b64(payload["encryptedKey"]),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    aesgcm = AESGCM(content_key)
    plaintext = aesgcm.decrypt(
        _b64(payload["iv"]),
        _b64(payload["ciphertext"]) + _b64(payload["tag"]),
        None,
    )
    value = json.loads(plaintext.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Encrypted evidence payload is not a JSON object")
    return value


def is_encrypted_event(row: dict) -> bool:
    return row.get("schema") == ENCRYPTED_EVENT_SCHEMA and isinstance(row.get("data"), dict) and row["data"].get("encrypted") is True


def decrypt_events(rows: list[dict], private_key) -> tuple[list[dict], list[dict]]:
    output = []
    warnings = []
    encrypted_count = 0
    for index, row in enumerate(rows, start=1):
        if not is_encrypted_event(row):
            output.append(row)
            continue
        encrypted_count += 1
        if private_key is None:
            continue
        try:
            decrypted = decrypt_payload(row["data"], private_key)
            decrypted["hash"] = row.get("hash")
            output.append(decrypted)
        except Exception as exc:
            warnings.append({
                "code": "encrypted_event_decrypt_failed",
                "message": "An encrypted events.jsonl line could not be decrypted",
                "details": {"line": index, "reason": str(exc)},
            })
    if encrypted_count and private_key is None:
        warnings.append({
            "code": "missing_evidence_private_key",
            "message": "Encrypted events were found, but the activity ZIP does not contain teacher-private/evidence-private-key.jwk",
            "details": {"encryptedEvents": encrypted_count},
        })
    return output, warnings
