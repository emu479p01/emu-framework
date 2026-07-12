# Future major dependency upgrades

Major upgrades are intentionally separate from framework update and documentation work.

| Group | Current major | Future major | Required coverage |
|---|---:|---:|---|
| Fastify and plugins | 4 | 5 | auth, multipart, static client, errors, maintenance APIs |
| Vite and Vue plugin | 5 | 8 | development server and production asset build |
| Vitest and jsdom | 2 / 26 | 4 / 29 | all workspace tests and DOM behavior |
| Pinia | 2 | 3 | session, metadata, and Designer stores |
| Vue Router | 4 | 5 | guards, capabilities, navigation, lazy routes |
| TypeScript | 5 | 7 | all package typechecks and emitted server/CLI code |

Upgrade one compatible group at a time, read its migration guide, regenerate the lockfile, and keep each change independently reversible.
