# Pull Request

## What does this change?

<!-- One or two sentences. What is different after this PR is merged? -->

## Why?

<!-- The problem being solved, not a restatement of the diff.
     Link the issue it closes, if there is one: Closes #123 -->

## How should this be verified?

<!--
     For a user-visible change: the steps a reviewer can follow to see it work.
     For a build/release change: which command proves it, and what output
     should appear.
-->

- [ ] `pnpm format:check && pnpm lint:strict && pnpm type-check && pnpm test:coverage && pnpm build && pnpm release:check` passes locally
- [ ] New behaviour has a test, or the change is documentation-only
- [ ] No API key, token, or other credential appears in the diff

## Checklist

- [ ] The change does not add a new permission or a new host permission
- [ ] The change does not introduce a network request to a new destination
- [ ] The change does not add a new dependency
- [ ] The privacy policy and the store listing still describe what the
      extension actually does (they have to agree — a listing that promises
      something the code does not do is a rejection)
- [ ] If the content script's registration changed, the manual smoke test in
      `docs/chrome-web-store-release.md` was run, including the step that
      checks the content script still runs on a normal page
