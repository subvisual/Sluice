# PRDs and Issues

How the building skills should find and write PRDs and issue files.

**Location:** `docs/prds/`

## Feature slugs

One PRD per feature, named with the feature's slug (`wiring-delivery`
is the shared-context area, not a fourth feature, but it carries a PRD like the others):

| Slug | Feature |
| --- | --- |
| `f1-aqua-strategy-vm` | F1 — Aqua & the Strategy VM (1inch Aqua + SwapVM) |
| `f2-private-recommendations` | F2 — Private Recommendations (0G) |
| `f3-market-book-context` | F3 — Market & Book Context (The Graph) |
| `wiring-delivery` | Wiring & Delivery |

Each feature's local index is in `docs/features/<slug>/README.md`.

Work that doesn't fit one of these four is a signal to reconsider the feature split — either it
belongs to a feature under a name you haven't read yet, or the split needs updating first.

## How each skill uses this

- **`/write-a-prd`** writes its output to `docs/prds/<slug>.md`. Read the feature's local
  README first — the PRD refines it for implementation, it does not restate it.
- **`/prd-to-issues`** writes its output to `docs/prds/<slug>-issues.md`. If multiple PRDs
  exist, ask the user which one.
- **`/issue-worker`** reads the issues file from `docs/prds/*-issues.md`. If multiple issues
  files exist, ask the user which one. Determines the next issue by checking git log for
  commits referencing previous issue titles — the next issue is the first one in dependency
  order whose title doesn't appear in a commit message.

## Conventions

- One PRD per feature, using the slugs above
- The issues file lives alongside its parent PRD, with the suffix `-issues.md`
- Issues are committed one at a time by `/issue-worker`; the commit message must reference
  the issue title so subsequent runs know where to pick up
- Cross-feature dependencies belong in `wiring-delivery`, not duplicated into F1–F3
