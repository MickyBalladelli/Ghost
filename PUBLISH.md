# Publishing Ghost

This guide publishes Ghost to the Visual Studio Code Marketplace.

Official references:

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage/publishers/)

## 1. Check `package.json`

Ghost currently uses:

```json
{
  "name": "ghost-ai-coding-assistant",
  "publisher": "MickyBalladelli",
  "version": "1.1.96",
  "icon": "icon.png"
}
```

The Marketplace extension ID is `publisher.name`, so the current ID is `MickyBalladelli.ghost-ai-coding-assistant`. Keep the publisher and name aligned with the Marketplace item.

Before publishing, check that:

- The version is a new valid SemVer version.
- `icon.png` exists.
- `README.md` describes the current features.
- Repository and author metadata are correct.
- No secrets, tokens, `.env` files, or private data are packaged.

## 2. Create a Marketplace publisher

Open [Marketplace Publisher Management](https://marketplace.visualstudio.com/manage/publishers/) and sign in with your Microsoft account.

Create a publisher with:

- A unique publisher ID. This cannot be changed later.
- A display name, such as `Micky Balladelli` or `Ghost`.

The publisher ID must match `package.json`.

## 3. Create publishing credentials

The current `vsce` workflow uses an Azure DevOps Personal Access Token (PAT).

Create a token with Marketplace publish permission:

```text
vso.gallery_publish
```

Copy it to a password manager. Never commit it or put it in project files.

Microsoft says global Azure DevOps PATs retire on December 1, 2026. For long-term automation, use the identity-based or Entra ID flow in the official [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## 4. Install and log in to `vsce`

```bash
npm install --global @vscode/vsce
vsce --version
vsce login MickyBalladelli
```

Paste the PAT when prompted. Use the current publisher ID from `package.json`; do not log in as the extension name.

For automation, use a protected secret instead:

```bash
VSCE_PAT="$YOUR_VSCE_PAT" npx --no-install vsce publish --packagePath ./ghost-ai-coding-assistant-1.1.96.vsix
```

## 5. Build Ghost

From the repository root:

```bash
npm ci
npm run package
```

`npm run package` compiles the TypeScript extension output and creates a versioned VSIX.

Check release versions before installing or publishing:

```bash
npm run release:check
```

## 6. Install and test the VSIX

The package script creates:

```bash
ghost-ai-coding-assistant-1.1.96.vsix
```

Install it locally:

```bash
code --install-extension ./ghost-ai-coding-assistant-1.1.96.vsix --force
```

Verify the following before publishing:

- Ghost appears in the Extensions view with the correct icon.
- README and badges render correctly.
- Ollama, MLX/VLM, and OpenAI-compatible providers work.
- Model selection works.
- Ask, Edit, Agent, Explain, and Inline modes work.
- Agent mode reads files and applies approved edits.
- File edits show diffs and require approval.
- Terminal commands require approval.
- Conversation history, import, export, and persistence work.
- Context chips, tool lists, tool approval, and restore work.
- The composer stays fixed while responses scroll.
- The thinking animation works.
- Light, dark, and high-contrast themes work.

## 7. Publish the first release

After the local VSIX check succeeds, publish the exact artifact:

```bash
npx --no-install vsce publish --packagePath ./ghost-ai-coding-assistant-1.1.96.vsix
```

For a logged-in local publisher, log in once with `MickyBalladelli` and run the same command. In CI, provide `VSCE_PAT` as a protected secret. The Marketplace item is:

```bash
https://marketplace.visualstudio.com/items?itemName=MickyBalladelli.ghost-ai-coding-assistant
```

## 8. Publish updates

Every Marketplace release needs a new version:

```bash
npm version patch --no-git-tag-version
```

Add a dated `CHANGELOG.md` heading for the new version, then package (this runs `release:check`) and publish:

```bash
npm run package
npx --no-install vsce publish --packagePath "./ghost-ai-coding-assistant-$(node -p "require('./package.json').version").vsix"
```

Use `patch` for bug fixes, `minor` for backwards-compatible features, and `major` for breaking changes:

```bash
npm version patch --no-git-tag-version
npm version minor --no-git-tag-version
npm version major --no-git-tag-version
```

Check both `package.json` and `package-lock.json` before committing. Bump the version before packaging; do not reuse a published version.

```bash
npm version minor --no-git-tag-version
npm install --package-lock-only
npm run package
npm run release:check
npx --no-install vsce publish --packagePath "./ghost-ai-coding-assistant-$(node -p \"require('./package.json').version\").vsix"
```

## 9. Tag the release

Replace `1.1.96` with the actual release version:

```bash
git add package.json package-lock.json CHANGELOG.md README.md PUBLISH.md docs
git commit -m "Release Ghost 1.1.96"
git tag v1.1.96
git push origin main --tags
```

## Automated publishing

Store the publishing token as a protected CI secret named `VSCE_PAT`. Never print it in logs.

Typical CI commands:

```bash
npm ci
npm run package
VSCE_PAT="$VSCE_PAT" npx --no-install vsce publish --packagePath ./ghost-ai-coding-assistant-1.1.96.vsix
```

Use a protected release branch or manual approval before publishing. Prefer identity-based publishing as PAT retirement approaches.

## Unpublishing

Avoid unpublishing when possible. Publish a fixed version instead. If unpublishing is unavoidable, inspect the available command first:

```bash
vsce --help
```

Confirm the exact publisher and extension ID before running it.
