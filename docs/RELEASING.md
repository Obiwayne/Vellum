# Releasing Vellum

A release is a tag. Pushing a tag like `v1.0.0` runs `.github/workflows/release.yml`, which builds the Windows installer and puts it in a **draft** GitHub Release. Nothing is visible to users, and no installed copy updates, until a person publishes that draft.

## Make a release

1. Set `version` in `package.json` (and nothing else: the installer name, `latest.yml` and the What's new dialog read it). Commit it to `master` through the normal review.
2. Wait for CI to be green on that commit.
3. Tag the commit and push the tag:
   ```
   git tag v1.0.0
   git push origin v1.0.0
   ```
   The tag must equal the `package.json` version with a `v` in front. If it does not, the workflow fails at its first step and builds nothing.
4. Watch the **Release** run under the repository's Actions tab. It runs `npm ci`, typecheck and `npm test`, builds the installer and uploads it to the draft.
5. Open the draft under Releases. It holds three files: `Vellum-Setup-1.0.0.exe`, `Vellum-Setup-1.0.0.exe.blockmap` and `latest.yml`.
6. Write the release notes in the draft's body. The update card shows this text as the release notes.
7. Install the `.exe` from the draft on a clean Windows user and check it opens. The installer is unsigned for now, so Windows shows "Windows protected your PC": More info, Run anyway.
8. Click **Publish release**. Installed copies find it on their next check (15 seconds after start, then every 4 hours).

## Roll back

- **The draft is wrong:** delete the draft and the tag (`git push origin :refs/tags/v1.0.0`), fix, and tag again. Delete the old draft first: a tag pushed again while its draft exists builds a second draft.
- **A published release is wrong:** turn it back into a draft (or delete it) at once, because installed copies only see published releases. Users who already updated keep the version they have. To move them off a bad build, publish a higher version (`v1.0.1`) with the fix: the updater never goes backwards.

## Notes

- The workflow needs no secrets of its own: it uses the `GITHUB_TOKEN` the run is given, with `contents: write`.
- Builds are unsigned until a certificate is chosen; signing is a separate task.
- To test the installer and the update path without a release, use `npm run test:installer` and the local-feed update test (T49).
