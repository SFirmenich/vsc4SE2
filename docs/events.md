# Event Model

Events are stored as JSON Lines in
`.vsc4education/contributions/<studentId>/events.jsonl`. Each student has an
independent hash chain.

```json
{
  "id": "uuid",
  "studentId": "ana-001",
  "timestamp": "2026-06-11T10:00:00.000Z",
  "event": "file_saved",
  "taskId": "encapsulation",
  "data": {
    "file": "src/Animal.ts"
  },
  "previousHash": "previous-hash",
  "hash": "current-hash"
}
```

The hash is calculated as:

```text
SHA256((previousHash or "") + canonicalJson(event without hash))
```

Canonical JSON recursively sorts keys. The first event uses
`previousHash: null`.

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

Text-change events record counts and line ranges, not the edited content.
