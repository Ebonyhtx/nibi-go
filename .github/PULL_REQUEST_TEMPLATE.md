## Summary

<!-- What changed and why? Keep it focused. -->

## Behavior

<!-- Before / after. For UI changes, include a screenshot or a short recording. -->

## Verification

<!-- Commands you ran and their results. Do not mark a check as passing if it was skipped. -->

- [ ] `pnpm -r test`
- [ ] `pnpm -r typecheck`
- [ ] `node scripts/check-boundaries.mjs`
- [ ] `node scripts/check-public-repo.mjs`
- [ ] rendered/device check for visual changes (or state why not possible)

## Public repository checklist

- [ ] No credentials, private keys, internal hostnames/IPs, or machine-specific paths
- [ ] No kernel source vendored into this repository
- [ ] No self-hosted runners, repository secrets, or `pull_request_target` in workflows
- [ ] New or changed actions are pinned to a full commit SHA
- [ ] Documentation is public-facing and does not describe internal operations

## Related issues

<!-- Link issues with `Closes #...` when applicable. -->
