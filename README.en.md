# NIBI-GO

[简体中文](README.md) | English

NIBI-GO is the **mobile client** of the NIBI ecosystem. NIBI-GO is the default
app body (an on-device AGENT):

- **NIBI-GO (default body)**: on-device AGENT; its plugin ecosystem is separate
  from the desktop plugin system (D13);
- **NIBI-WORK (entry)**: desktop remote control entered from the GO body
  (Relay V2 end-to-end channel with conversation, approval and task
  projection). It is no longer a parallel primary product.

This repository is the public source of NIBI-GO (Android client, pure-TS
protocol layers, native modules, Android kernel adaptation). The on-device
kernel and Android native runtime ship with the app and are built in this
repository; see [`docs/`](docs/README.md) for architecture decisions and
implementation status.

## Open-source scope

Included:

- `app/` — Expo / React Native application (login, QR pairing, connection
  status, chat, approvals, notifications, keep-alive, in-app updates)
- `app/modules/` — local Expo native modules (kernel host, foreground KeepAlive
  service, APK installer)
- `kernel/` — Android kernel adaptation (ships with the app)
- `packages/kernel-session`, `packages/relay-client`, `packages/chat-core`,
  `packages/shared-extract`, `packages/phone-tools` — pure-TS protocol layers
- `docs/` — architecture decisions (D1–D25), design specs, research, checklists
- `scripts/` — architecture and public-repository gates

Not included:

- release signing material, release pipelines and operator services;
- any private deployment details or credentials (see [SECURITY.md](SECURITY.md)).

The historical reference archive has been moved out of this repository; it is
not part of any build, and `reference/` no longer exists here.

## Plugin market

The official plugin market lives in a separate public repository,
[nibi-go-market](https://github.com/Ebonyhtx/nibi-go-market). The client accepts only the
officially signed index and verifies every package against its `sha256`. Third-party plugins
are submitted via pull request; the submission format and review criteria are documented in
that repository's
[CONTRIBUTING](https://github.com/Ebonyhtx/nibi-go-market/blob/main/CONTRIBUTING.md).

Plugins are **code that runs**: installing a third-party plugin runs software provided by its
author. Review reduces risk but is not a guarantee; install only entries you trust. Index
format, signature verification and rollback protection are described in
[`docs/design/market-index.md`](docs/design/market-index.md).

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
| `packages/phone-tools` | Phone tool interface (multi-platform adapters; former B0, now part of the Phase C prerequisite) |
| `app/modules/kernel-host` | Kernel JNI layer (Phase C; before D24 Phase 0 it still fetches upstream `4.1.0` `libnibi.so`; after Phase 0 it uses this repo's `kernel/`) |
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

- **Phase A** (code-complete): NIBI-GO app body and the NIBI-WORK remote-control
  entry. Zero kernel coupling.
- **Phase B** (cancelled, D6): phone-control routing for the WORK form
  (nibi-phone-bridge); the B0 tool surface (`packages/phone-tools`) moved to the
  Phase C prerequisite.
- **Phase C** (C0 completed, verified on device 2026-11-15): on-device kernel (`libnibi.so`, in-process, D19).
  D24/D25 fixed: the kernel is forked into this repo and the Android native runtime is rolled out in phases; see
  [ADR-INDEX D24/D25](docs/decisions/ADR-INDEX.md) and `docs/design/android-native-runtime.md`.
  Trigger conditions in [ADR-INDEX D12](docs/decisions/ADR-INDEX.md).

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
See [LICENSING.md](LICENSING.md) for the license map and
[TRADEMARKS.md](TRADEMARKS.md) for names and marks.
