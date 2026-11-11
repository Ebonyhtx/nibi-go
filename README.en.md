# NIBI-GO

[简体中文](README.md) | English

NIBI-GO is the **mobile client** of the NIBI ecosystem. It has two forms:

- **NIBI-WORK**: control your desktop from the phone (Relay V2 end-to-end
  channel with conversation, approval and task projection);
- **NIBI-GO**: an on-device AGENT (Phase C, paused; its plugin ecosystem is out
  of scope for this repository).

This repository is the public source of NIBI-GO (Android client, pure-TS
protocol layers, native modules). The Rust kernel is **not** part of this
repository — it is consumed as an external npm platform package
(`@nibi-studio/cli-*`); see rule D17 in [AGENTS.md](AGENTS.md).

## Open-source scope

Included:

- `app/` — Expo / React Native application (login, QR pairing, connection
  status, chat, approvals, notifications, keep-alive, in-app updates)
- `app/modules/` — local Expo native modules (foreground KeepAlive service,
  APK installer)
- `packages/relay-client`, `packages/chat-core`, `packages/shared-extract`,
  `packages/phone-tools` — pure-TS protocol layers
- `docs/` — architecture decisions (D1–D18), design specs, research, checklists
- `scripts/` — architecture and public-repository gates

Not included:

- the Rust kernel (separate project in `nibi-client`, consumed as npm packages);
- release signing material, release pipelines and operator services;
- any private deployment details or credentials (see [SECURITY.md](SECURITY.md)).

`reference/` is an optional, developer-local read-only upstream checkout
(gitignored; not part of this repository, not part of any build).

## Requirements

- Node.js **24.22.2**
- pnpm **10.33.2**
- Git

Versions are pinned in [mise.toml](mise.toml). Android development additionally
needs the Android SDK (platform 35 / build-tools 35.0.0 / emulator) and JDK 17;
the Windows CMake short-path requirement is handled by
`app/plugins/withCmakeVersion.js`.

## Quick start

```bash
pnpm install
pnpm -r test
node scripts/check-boundaries.mjs
node scripts/check-public-repo.mjs
```

Mobile development:

```bash
cd app
pnpm exec expo start          # Metro (Expo Go)
pnpm exec expo run:android    # dev-client build + install
```

Login requires an OIDC native app registered in the NIBI account center with the
`nibigo://login` callback, injected via `EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID`.
Without it, login fails loudly instead of degrading silently.

## Repository layout

| Directory | Responsibility |
|---|---|
| `app/` | Expo SDK 58 app (expo-router routes in `src/app/`) |
| `app/modules/nibi-keepalive` | Foreground service keep-alive (Spike 2: Android kills background sockets) |
| `app/modules/nibi-updater` | APK installer (FileProvider + PackageInstaller, SHA-256 verified) |
| `packages/relay-client` | Relay V2 terminal client: state machine, pairing, workspace bridge, E2E envelope |
| `packages/chat-core` | Chat state machines: V4 reducer host, replay/gap, approvals, AgentPulse |
| `packages/shared-extract` | Protocol contracts extracted from nibi-client (source headers, see [NOTICE.md](NOTICE.md)) |
| `packages/phone-tools` | Phone tool interface (multi-platform adapters; Phase B) |
| `modules/kernel-host` | Kernel JNI layer (Phase C, skeleton only) |
| `docs/` | Decision ledger, design specs, research, checklists (entry: [docs/README.md](docs/README.md)) |
| `scripts/` | Architecture gate, public-repo check, extraction scripts |

## Development and verification

```bash
pnpm -r test                        # all tests (relay-client / chat-core run on Node)
pnpm -r typecheck                   # type checking
node scripts/check-boundaries.mjs   # layer boundaries (protocol layers: no RN/expo imports)
node scripts/check-public-repo.mjs  # public-tree policy
```

Run these before submitting. Public CI runs the same gates on GitHub-hosted
runners only.

## Configuration

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_NIBI_GO_OIDC_CLIENT_ID` | OIDC native app client id for NIBI-GO |
| `EXPO_PUBLIC_NIBI_ENDPOINT_ORIGIN` | endpoint origin override (self-hosted testing) |
| `EXPO_PUBLIC_NIBI_RELAY_WS_URL` | relay ws2 endpoint override |
| `EXPO_PUBLIC_NIBI_RELEASE_REPO` | release repository for in-app updates (`owner/repo`) |
| `NIBIGO_CXX_STAGING` / `NIBIGO_CMAKE_VERSION` | Android native build dir / CMake version overrides |

See [app/.env.example](app/.env.example).

## Roadmap

- **Phase A** (current, code-complete): native NIBI-WORK remote-control client.
  Zero kernel coupling.
- **Phase C** (paused): on-device kernel. Trigger conditions in
  [ADR-INDEX D12](docs/decisions/ADR-INDEX.md).
- **Phase B** (last): phone-control routing for the WORK form (nibi-phone-bridge).

## Contributing

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Report security issues privately per [SECURITY.md](SECURITY.md).
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Architecture and design docs: [docs/README.md](docs/README.md).

## License and provenance

Released under the **Apache License 2.0**. Protocol contracts in
`packages/shared-extract/` are extracted from
[nibi-client](https://github.com/Ebonyhtx/nibi-client) (Apache-2.0, commit
`ff1c5f4f`); upstream lineage (ZCode v3.16.2) and third-party notices are in
[NOTICE.md](NOTICE.md) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
