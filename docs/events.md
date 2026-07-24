# Event Model

Events are stored as encrypted JSON Lines in
`.vsc4education/contributions/<studentId>/events.jsonl`. Each student has an
independent hash chain. The student package contains the public evidence key;
the teacher package contains the matching private key.

```json
{
  "id": "uuid",
  "schema": "vsc4e.event.encrypted.v1",
  "keyId": "vsc4e-key-id",
  "data": {
    "encrypted": true,
    "alg": "RSA-OAEP-256+A256GCM",
    "iv": "base64",
    "encryptedKey": "base64",
    "ciphertext": "base64",
    "tag": "base64"
  },
  "hash": "current-hash"
}
```

After decrypting `data`, the logical event contains `studentId`, `timestamp`,
`event`, `taskId`, event `data`, and `previousHash`. The stored `hash` is
calculated from that decrypted logical event:

```text
SHA256((previousHash or "") + canonicalJson(event without hash))
```

Canonical JSON recursively sorts keys. The first decrypted event uses
`previousHash: null`. Consumers without the teacher private key can parse the
encrypted envelopes but cannot verify the logical hash chain or calculate
event-based metrics.

## MVP Events

- `activity_loaded`
- `student_registered`
- `student_session_started`
- `task_started`
- `task_finished`
- `active_editor_changed`
- `file_changed`
- `file_saved`
- `file_created`
- `file_deleted`
- `terminal_opened`
- `heartbeat`
- `submission_exported`
- `event_server_receipt`
- `agents_file_restored`
- `foreign_contribution_modified`

Before export, `submission_exported` is appended to the log and then the final
Git checkpoint is created. Automatic tracking and heartbeat events are paused
while the ZIP is being created.

## Repository Event Receipts

Activities may optionally configure a Repository event server in
`manifest.repository.eventServer`. When enabled and reachable, the student
extension sends selected encrypted event envelope hashes to the configured
Repository. The Repository records server receipt time and returns a signed
receipt. The student extension then appends an encrypted `event_server_receipt`
event to the same `events.jsonl` chain.

The student extension attempts Repository anchoring for these events:

- `student_registered`
- `student_session_started`
- `task_started`
- `task_finished`
- `active_editor_changed`
- `submission_exported`

Heartbeat anchoring is sampled instead of mirrored completely. For each
contribution, the extension keeps a rolling 30-heartbeat window and randomly
selects one heartbeat position in that window for Repository anchoring. This
keeps periodic liveness evidence without duplicating every local heartbeat on
the server.

The logical receipt event uses this shape:

```json
{
  "event": "event_server_receipt",
  "data": {
    "anchoredEventId": "uuid",
    "anchoredEventHash": "sha256",
    "repositoryBaseUrl": "https://repo.example.edu",
    "serverReceivedAt": "2026-07-24T11:19:04Z",
    "signingKeyId": "repo-local-2026-01",
    "receiptSignature": "base64",
    "receiptPayloadHash": "sha256",
    "receipt": {
      "payload": {
        "schema": "vsc4e.event.receipt.v1",
        "activityId": "poo-basico-01",
        "version": "1.0.0",
        "studentId": "ana-001",
        "contributionId": "ana-001",
        "clientSessionId": "uuid",
        "eventId": "uuid",
        "eventHash": "sha256",
        "previousHash": "sha256-or-null",
        "clientTimestamp": "2026-07-24T11:19:00Z",
        "envelopeSha256": "sha256",
        "sequence": 1,
        "serverReceivedAt": "2026-07-24T11:19:04Z"
      },
      "signature": "base64",
      "signingKeyId": "repo-local-2026-01"
    }
  }
}
```

Receipts are review signals. A valid receipt proves that the configured
Repository signed that receipt payload with its private signing key. It does
not prove authorship, intent, or that every local event was observed by the
server.

## Agent Conversations

Conversations are not part of `events.jsonl`. They are stored separately in
`.vsc4education/contributions/<studentId>/agent-interactions.jsonl`:

```json
{"timestamp":"ISO-8601","actor":"student","message":"..."}
{"timestamp":"ISO-8601","actor":"agent","agent":"claude","message":"..."}
```

Supported providers are `chatGPT`, `claude`, and `copilot`.

The student extension mirrors complete rows from `agent-interactions.jsonl` into
encrypted evidence:

```text
.vsc4education/contributions/<studentId>/agent-evidence.jsonl
```

Each `agent-evidence.jsonl` row uses schema
`vsc4e.agent-evidence.encrypted.v1`, records the source line and a hash of the
clear row, and encrypts the original interaction row with the activity public
key. Student submissions include both `agent-interactions.jsonl` and
`agent-evidence.jsonl`.

Text-change events record counts and line ranges, not the edited content.
