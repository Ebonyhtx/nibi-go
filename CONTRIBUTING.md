# Contributing to NIBI-GO

Thanks for taking the time to contribute. This repository is the public NIBI-GO
mobile client; it is meant to be buildable, testable, and understandable without
any private service or credential.

## Before you start

- Read [AGENTS.md](AGENTS.md) for repository rules and validation discipline.
- Read [docs/decisions/ADR-INDEX.md](docs/decisions/ADR-INDEX.md) for the
  architecture decisions this codebase follows.
- Read [docs/plan.md](docs/plan.md) for the milestone structure.
- For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a
  public issue.

## Development setup

Requirements: Node.js 24.22.2, pnpm 10.33.2, and Git. Versions are pinned in
[mise.toml](mise.toml).

```bash
pnpm install          # workspace dependencies
pnpm -r test          # all tests (relay-client / chat-core must run on Node)
node scripts/check-boundaries.mjs
node scripts/check-public-repo.mjs
```

Android development (dev-client build) additionally needs the Android SDK
(platform 35, build-tools 35.0.0, emulator) and JDK 17. See `app/README` notes in
[AGENTS.md](AGENTS.md); the CMake/短路径 requirement is handled by
`app/plugins/withCmakeVersion.js`.

```bash
cd app
pnpm exec expo start                 # Metro (Expo Go)
pnpm exec expo run:android           # dev-client build + install
```

## Pull requests

- Keep each pull request focused on one behavior or refactor.
- Describe the background, the design intent, and the behavior before/after.
- For bug fixes, include the trigger, the root-cause evidence, the fix, and the
  regression test.
- Add or update tests when behavior changes. UI interaction changes need a
  rendered or device check where practical.
- Do not include generated build output, local data directories, logs, or
  screenshots containing personal paths or credentials.
- By submitting a pull request you agree that your contribution is licensed
  under the Apache License 2.0.

## Public repository rules

These rules are enforced by CI (`scripts/check-public-repo.mjs`) and review:

1. **No secrets or credentials.** Never commit tokens, private keys, cookies,
   signing material, keystore passwords, or real provider keys. Test fixtures
   must use obviously fake values.
2. **No internal infrastructure.** Do not add private IP addresses, internal
   hostnames, VPN/SSH details, server paths, or operator runbooks. Public
   product endpoints are fine; private deployment details are not.
3. **No private paths.** Do not commit absolute paths such as `D:\...`,
   `/Users/<name>/...`, or machine-specific cache locations.
4. **No kernel source.** The Rust kernel is an external npm dependency
   (`@nibi-studio/cli-*`); do not vendor it into this repository.
5. **No self-hosted runners in public workflows.** Public CI runs on
   GitHub-hosted runners only.
6. **Use `pull_request`, never `pull_request_target`.** Fork pull requests must
   not receive repository secrets.
7. **Least privilege.** Workflows declare `permissions: contents: read` unless a
   step genuinely needs more; document why if it does.
8. **Pin actions.** Third-party actions are pinned to a full commit SHA.
9. **Public-facing documentation.** Do not document internal business plans,
   pricing, incidents, customer data, or private service topology.

Run `node scripts/check-public-repo.mjs` before pushing.

## Code conventions

- Protocol layers (`packages/relay-client`, `packages/chat-core`,
  `packages/shared-extract`) must stay framework-free: no `react-native`, `expo`,
  or `react` imports (`node scripts/check-boundaries.mjs` enforces this).
- `packages/shared-extract` follows the extraction discipline in AGENTS.md
  rule 6: source commit headers, no semantic rewrites, contract tests.
- Prefer the existing module boundaries and public entry points.
- Keep comments about constraints, not about the change itself.
- Match the surrounding code's naming and comment density.

## Tests

- `relay-client` / `chat-core` tests must run on plain Node (fake-relay fixtures,
  no RN runtime).
- `app` tests cover pure logic (updater, sessions-index) with vitest.
- Device-only checks (accessibility, background survival, installer) are listed
  in [docs/checklists/真机验证清单.md](docs/checklists/真机验证清单.md) and must be
  reported as not-run when they were not executed.

## Review and merge

- A pull request needs a green public CI run and review approval.
- Squash or rebase to keep the history readable.

## Contact

For non-security questions, open a GitHub issue. For security reports, use the
private channel described in [SECURITY.md](SECURITY.md).
