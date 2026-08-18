# Dependency policy

Ghost keeps `package-lock.json` committed. Dependency changes must update the lockfile with `npm install` or `npm ci` validation and must pass the CI dependency audit.

## Automated checks

- Dependabot opens grouped npm updates every Monday.
- CI runs `npm run security:audit` on every push and pull request.
- Pull requests run GitHub's dependency review check before merge.
- High and critical advisories fail CI. A temporary exception needs a tracked issue, an owner, an expiry date, and a short mitigation note.

## Review cadence

- Triage Dependabot pull requests every Monday. Keep one focused update per dependency group and close duplicates after checking the changelog and advisory record.
- Review provider transport, compiler, VS Code API types, packaging, and test-tool updates before merging. Confirm the lockfile changes contain only the intended packages.
- Perform a monthly dependency inventory: remove unused packages, check direct dependencies for newer supported majors, and confirm the VSIX does not include development-only files.
- Review major-version upgrades separately each quarter. Record compatibility notes, required migrations, CI evidence, and a rollback version in the changelog or release notes.
- Treat security advisories outside the cadence: assess them within one business day and ship a fix or documented mitigation within three business days when practical.

## Review rules

- Update TypeScript, `@types/node`, and `@types/vscode` together when their compiler or API types are coupled. Confirm the declared VS Code engine still supports the selected types, then run compile and the host-test matrix.
- Review `node-fetch`, proxy agents, and related provider transport packages for request, TLS, redirect, timeout, and error-handling changes. Run provider fixtures and resilience tests.
- Review `@vscode/vsce` changes against `.vscodeignore`, the generated VSIX manifest, and the package smoke-install job. Do not publish a package that contains source maps, tests, secrets, or local model data.
- Review Mocha, `@types/mocha`, `@vscode/test-electron`, Node types, and ESLint updates as test-infrastructure changes. Run both fast and extension-host suites on Linux, macOS, and Windows.
- Avoid unrelated major-version upgrades in feature pull requests. Land major upgrades separately with a changelog entry and a rollback path.

## Security updates

Apply security fixes promptly. Prefer the smallest compatible version bump, inspect the dependency tree and advisory details, then rerun compile, fast tests, host tests, packaging, and VSIX smoke installation before merging.
