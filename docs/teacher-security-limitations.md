# Security and limitations

- Imported archives are treated as untrusted data.
- ZIP extraction rejects absolute paths and `..` traversal, and limits entries
  and total uncompressed bytes.
- Student code is never executed and dependencies are never installed.
- Git access uses only read operations through `git log`, `git show`, and
  `git diff`.
- WebViews use a Content Security Policy, no `eval`, and HTML escaping.
- Event hashes establish internal local consistency only. They are not a
  digital signature and do not prove authorship or completeness.
- Agent logs may be incomplete because recording depends on external tools
  following the activity instructions.
- Binary diffs and very large text diffs are intentionally not rendered in the
  MVP review panel.
