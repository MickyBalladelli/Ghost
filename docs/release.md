# Ghost release guide

This guide releases the VS Code extension from the repository root. Current manifest identity:

```text
publisher: MickyBalladelli
name: ghost-ai-coding-assistant
version: 1.1.96
Marketplace ID: MickyBalladelli.ghost-ai-coding-assistant
```

Replace the version with the release version being prepared. Do not publish a version that is already on the Marketplace.

## 1. Prepare the release

Start from the intended release branch and inspect the worktree:

```bash
git status --short
git log -5 --oneline
node -p "require('./package.json').version"
```

Before changing the version:

- finish the relevant TODO items;
- update the top section of `CHANGELOG.md` with user-visible changes and the release date;
- update README and provider/tool documentation when behavior changed;
- check that `package.json` and `package-lock.json` use the same version;
- confirm no secrets, local model files, `.env` files, VSIX files, or generated test data are tracked.

Use one version bump for a release. The commands below update `package.json` and the lockfile without creating a Git tag automatically. The `version` npm script also syncs the README and `docs/release.md` markers:

```bash
npm version patch --no-git-tag-version
```

Then add a dated `CHANGELOG.md` heading for that version. Use `minor` for a backwards-compatible feature and `major` only for an intentional breaking change. Review the generated diff before continuing.

## 2. Install and validate dependencies

Use the lockfile in release and CI environments:

```bash
npm ci
npm run security:audit
```

High and critical npm advisories must be resolved or have an explicit, time-limited exception documented according to [the dependency policy](dependency-policy.md).

## 3. Run the release checks

Run the compiler, fast tests, and extension-host tests:

```bash
npm run compile
npm run test:fast
npm run test:host
```

`npm test` is the combined local command:

```bash
npm test
```

The host suite needs a VS Code-capable environment. On Linux CI, run it under `xvfb-run`. The GitHub Actions matrix also checks Linux, macOS, and Windows.

## 4. Build the VSIX

The package script compiles first and lets `vsce` create a versioned package from the manifest:

```bash
npm run package
```

The default artifact is named like:

```text
ghost-ai-coding-assistant-1.1.96.vsix
```

`npm run package` runs the release consistency check after packaging. It compares `package.json`, `package-lock.json`, the README release marker, the latest changelog heading, `docs/release.md`, and every root VSIX artifact, including the embedded extension manifest.

For the local install helper, use the repository script. It builds `<package-name>-<version>.vsix` from the current `package.json` version and installs it with the local `code` CLI. It does not bump the version:

```bash
./create-vsix.sh
```

For a controlled release, bump and review the version first, then run `npm run package`.

## 5. Install and smoke-test

Install the exact artifact in a local VS Code installation:

```bash
code --install-extension ./ghost-ai-coding-assistant-1.1.96.vsix --force
```

The automated smoke script downloads a clean VS Code copy when needed, installs the VSIX, and verifies the extension ID:

```bash
node scripts/smokeVsix.js ./ghost-ai-coding-assistant-1.1.96.vsix
```

Manually verify the important user paths:

- extension activates and the Ghost view opens;
- Ollama, MLX/VLM, and OpenAI-compatible provider settings load;
- model discovery and provider health show useful status;
- Ask, Edit, Agent, Explain, and Inline modes respond;
- file reads, approved edits, diff preview, restore, and terminal approval work;
- cancellation removes active thinking state and pending approvals;
- history, import/export, persistence, redaction, and reset work;
- light, dark, and high-contrast themes render correctly;
- the thinking animation and screen-reader status remain usable.

`npm run package` and `create-vsix.sh` archive existing root VSIX files in `Trash/` before building. VSIX files and the archive are ignored by Git; keep only the artifact intended for the current release at the repository root.

## 6. Publish

Publishing requires a Marketplace publisher for `MickyBalladelli` and a protected `VSCE_PAT` secret with Marketplace publish permission. Never commit or print the token.

Publish the exact artifact after all checks pass:

```bash
npx --no-install vsce publish --packagePath ./ghost-ai-coding-assistant-1.1.96.vsix
```

For a logged-in local publisher, `npx --no-install vsce login MickyBalladelli` can be used once, followed by the same package command. In CI, use a protected secret and a manually approved release workflow; do not publish from every push.

After publishing:

1. open the Marketplace item and verify version, icon, README, links, and activation;
2. install the Marketplace version in a clean VS Code profile;
3. test provider setup and one approved file edit;
4. create the Git commit and tag only after Marketplace verification;
5. push the release commit and tag.

```bash
git add package.json package-lock.json CHANGELOG.md README.md docs
git commit -m "Release Ghost 1.1.96"
git tag v1.1.96
git push origin HEAD --tags
```

Use the actual release version in the commit and tag.

## 7. Roll back

Do not delete a Marketplace release as the first response. Preserve the broken artifact and logs, then:

1. stop any automated publish job;
2. identify whether the issue is packaging, activation, provider behavior, data migration, or a destructive tool path;
3. publish the smallest fixed patch version with a changelog entry;
4. tell users to update, or provide the last known-good VSIX for urgent local rollback;
5. if the release commit is not public, revert it with a new commit rather than rewriting shared history;
6. if a tag must be corrected before publication, move the release process to a new version instead of reusing a published version.

For a local rollback, install the known-good artifact:

```bash
code --install-extension ./ghost-ai-coding-assistant-<known-good-version>.vsix --force
```

Record the incident, affected versions, mitigation, and follow-up regression fixture. Never roll back by deleting user workspace or global state.

## CI release gates

`.github/workflows/ci.yml` runs compile and fast tests, the VS Code host suite on Linux/macOS/Windows, dependency audit, VSIX packaging, install smoke testing, and artifact upload. A release is ready only when those checks are green and the manual Marketplace verification is complete.
