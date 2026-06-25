# Security, Privacy, And Limitations

This extension generates local evidence of work. It is not an invulnerable
system or a forensic solution.

- The student controls their machine, files, Git, clock, and VS Code
  installation.
- The hash chain can detect accidental alterations or edits that break the
  chain, but a user with local control can regenerate it.
- Heartbeats help observe gaps; they do not prove why VS Code was closed or why
  the extension was inactive.
- The optional package signature is preserved, but the MVP does not validate
  `manifest.sig`.
- Full file contents are not recorded.
- `node_modules`, `.git`, `dist`, `out`, and contribution `events.jsonl` files
  are excluded where appropriate.
- Downloaded URLs must be trusted. The extractor rejects ZIP paths that escape
  the temporary directory.
- Exported submissions may include `.git` and the full local history.
- `AGENTS.md` protection works while the extension is active. A user with local
  control can disable the extension or modify files outside that period.
- The extension cannot read private ChatGPT, Claude, or Copilot chats. The
  `agent-interactions.jsonl` log depends on agents following the instructions in
  `AGENTS.md`.
- Binding a workspace to one student prevents the extension from writing as
  another classmate, but it does not create invulnerable filesystem
  permissions. A user with direct local access can still edit other
  contributions; the extension records these modifications when it can observe
  them.

High-stakes evaluation scenarios require external verification, institutional
policies, and controlled remote storage.
