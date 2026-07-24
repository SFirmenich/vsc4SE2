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
- `agents_file_restored`
- `foreign_contribution_modified`

Before export, `submission_exported` is appended to the log and then the final
Git checkpoint is created. Automatic tracking and heartbeat events are paused
while the ZIP is being created.

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
