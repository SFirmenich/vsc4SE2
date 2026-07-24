# Security, Privacy, And Limitations

This extension generates local evidence of work. It is not an invulnerable
system or a forensic solution.

- The student controls their machine, files, Git, clock, and VS Code
  installation.
- Event and agent evidence encryption reduces casual inspection and makes
  coherent falsification harder, but students still control their local
  workspace.
- The encrypted event hash chain can detect alterations after decryption with
  the teacher private key. Without that private key, consumers can only parse
  encrypted envelopes and preserve the artifact.
- Heartbeats help observe gaps; they do not prove why VS Code was closed or why
  the extension was inactive.
- The optional package signature is preserved separately from evidence
  encryption. Evidence encryption uses `signatures/evidence-public-key.jwk` in
  student packages and `teacher-private/evidence-private-key.jwk` in teacher
  packages.
- Full file contents are not recorded.
- `node_modules`, `.git`, `dist`, `out`, and contribution `events.jsonl` files
  are excluded where appropriate.
- Downloaded URLs must be trusted. The extractor rejects ZIP paths that escape
  the temporary directory.
- Exported submissions may include `.git` and the full local history.
- `AGENTS.md` protection works while the extension is active. A user with local
  control can disable the extension or modify files outside that period.
- The extension cannot read private ChatGPT, Claude, or Copilot chats. The
  clear `agent-interactions.jsonl` log depends on agents following the
  instructions in `AGENTS.md`; the extension mirrors complete JSONL rows into
  encrypted `agent-evidence.jsonl` when it observes them.
- Binding a workspace to one student prevents the extension from writing as
  another classmate, but it does not create invulnerable filesystem
  permissions. A user with direct local access can still edit other
  contributions; the extension records these modifications when it can observe
  them.

High-stakes evaluation scenarios require external verification, institutional
policies, and controlled remote storage.

`VSC4EducationRepository` inherits the same limitations when it imports
activity and submission ZIPs. It may store original archives, student
identifiers, event summaries, agent interaction counts, and Git history
included in submissions. Repository metrics and comparisons are review aids, not
proof of authorship or misconduct.
