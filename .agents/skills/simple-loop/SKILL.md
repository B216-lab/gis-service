---
name: simple-loop
description: Use when implementing features, bug fixes, or small refactors that must stay minimal, readable, tested, and reviewable.
---

Run minimal implementation loop:

1. Inspect relevant code first.
2. Ask only if ambiguity changes behavior, data model, API, or architecture.
3. Pick simplest effective change matching existing patterns.
4. Keep diff narrow. Avoid speculative refactors.
5. Add or update tests when behavior, contracts, or risk justify them.
6. Run relevant formatter, linter, tests, build, or compile checks.
7. Review own diff for bugs, regressions, missed edge cases, and accidental unrelated changes.
8. Fix found issues and rerun needed checks.
9. Report changed files and verification.
10. Do not commit unless user explicitly asks.

Skill policy:

- Do not load extra skills from this workflow.
- Rely on global skill routing or explicit user request for domain skills.
- After reading any domain skill, keep only a terse summary unless exact detail is needed.
- For final self-review, do not load heavy review skills unless user requested deep review.
- If user requested normal review, prefer `caveman-review`.
