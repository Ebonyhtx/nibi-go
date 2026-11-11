# Security Policy

## Supported versions

Security fixes are applied to the current public release line. Older releases may
not receive fixes; upgrade to the latest release before reporting an issue that
may already be resolved.

## Reporting a vulnerability

Please report security issues **privately**:

- Use GitHub's private vulnerability reporting on this repository
  (Security → Report a vulnerability), or
- Email `contact@nibistudio.top` with the subject `[SECURITY] NIBI-GO`.

Do **not** open a public issue, discussion, or pull request that describes an
unfixed vulnerability.

Include, when possible:

- affected version or commit
- Android version and device/emulator model
- a minimal reproduction or proof of concept
- impact assessment
- whether the issue requires a malicious desktop peer, relay, or local app

Do not include real credentials, personal data, or third-party secrets in the
report. If a credential may have leaked, rotate it first and say so.

## What to expect

- We aim to acknowledge reports within a few business days.
- We will confirm the affected versions and scope, then coordinate a fix and a
  disclosure date with you.
- We may ask for a private fork or a minimal patch to validate the issue.
- Credit is given by default unless you ask to remain anonymous.

## Scope

In scope:

- the Android app (`app/`), the relay/protocol layers
  (`packages/relay-client`, `packages/chat-core`, `packages/shared-extract`,
  `packages/phone-tools`) and the native modules in `app/modules/`
- pairing, device credentials, E2E envelope and key exchange, session replay,
  approval handling, notification and update paths
- build and release scripts that are part of the public repository
- dependency vulnerabilities that are reachable from the product

Out of scope:

- issues that require a compromised operating system, administrator access, or
  physical access
- vulnerabilities in third-party services (relay server, account center) that
  are not reachable through this client
- reports that only demonstrate missing hardening without a concrete impact
- social engineering, spam, or denial-of-service against hosted infrastructure

## Public repository and CI

This repository never stores release signing material, keystore passwords, or
real provider keys. OIDC client IDs are public OAuth identifiers by design.
Public workflows run on GitHub-hosted runners, use `pull_request` (not
`pull_request_target`), declare read-only permissions by default, pin third-party
actions to a full commit SHA, and do not receive repository secrets from forks.
If you find a workflow that violates these rules, treat it as a security report.

`scripts/check-public-repo.mjs` enforces the public-tree policy in CI.

## Release signing certificate

Android only accepts an in-place update when the new APK is signed with the same
certificate as the installed app. Official releases are signed with the project
release key; its certificate fingerprint is public information and is published
here so you can verify what you install:

`SHA-256  39:D4:5F:4E:51:92:AD:E5:D7:1D:0C:7D:81:14:DB:F8:C2:E7:D9:8A:EF:7B:75:38:16:24:84:88:4C:73:6A:48`

Verify a downloaded APK before installing:

```bash
apksigner verify --print-certs nibi-go-<version>.apk
```

The printed `certificate SHA-256 digest` must match the fingerprint above. An APK
that fails this check, or that is signed with a different certificate, is not an
official build — do not install it.

The private key is never stored in this repository. It exists as an encrypted
backup in a separate private repository, together with its passphrase; an
offline copy of the passphrase is also kept by the maintainer. `scripts/keystore.mjs`
(public) is the only tool that reads it; it takes the passphrase from an
environment variable or a local file and never prints it.


## Safe harbor

We will not pursue legal action for good-faith security research that:

- stays within the scope above
- avoids privacy violations, data destruction, and service disruption
- gives us reasonable time to fix the issue before public disclosure
- does not access data that is not yours

If you are unsure whether an action is allowed, ask first at
`contact@nibistudio.top`.
