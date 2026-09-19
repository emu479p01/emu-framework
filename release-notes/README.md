# EmuFramework release notes

This directory is the durable archive of EmuFramework release notes. The repository root [README](../README.md) keeps only the latest canonical English release-note block because the release workflow copies that block verbatim into the corresponding GitHub Release.

## Releases

| Version | Type | Released | Notes |
| --- | --- | --- | --- |
| 1.1.0 | FU — Framework Update | Unreleased | [1.1.0](1.1.0.md) |
| 1.0.2 | PU — Proactive Update | Unreleased | [1.0.2](1.0.2.md) |
| 1.0.1 | PU — Proactive Update | 2026-09-03 | [1.0.1](1.0.1.md) |
| 1.0.0 | FU — Framework Update | 2026-09-03 | [1.0.0](1.0.0.md) |

Legacy four-component releases remain immutable in Git history and on the [GitHub Releases page](https://github.com/emu479p01/emu-framework/releases). All new releases use `Major.Minor.Patch`.

## Adding a release note

1. Copy [TEMPLATE.md](TEMPLATE.md) to `Major.Minor.Patch.md`.
2. Classify the complete release by its highest-impact change:
   - **FU:** breaking structural change increments `Major` and resets `Minor.Patch` to `0.0`; backward-compatible important functionality increments `Minor` and resets `Patch` to `0`.
   - **PU:** bug fixes, hotfixes, and security fixes increment `Patch`.
3. Use the exact title `FU — EmuFramework vMajor.Minor.Patch` or `PU — EmuFramework vMajor.Minor.Patch` and complete every template section. Write `None` when a section has no entries.
4. Put the same note inside the single `release-notes:start` / `release-notes:end` marker pair in the root README. That README block is canonical for release automation.
5. Add the release to the top of the table in this file.
6. Run the repository release gates documented in the root README and `scripts/release-policy.mjs`.

Do not rewrite an existing note after its release merely to change release history. Corrective context should be added explicitly and should not alter an immutable tag or published artifact.
