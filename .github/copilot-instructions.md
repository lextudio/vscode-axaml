# Copilot Repository Instructions

Concise guidance for GitHub Copilot Chat & coding agent in this repository.

## Overview
VS Code Tools for AXAML provides a VS Code extension (package `vscode-axaml`) offering AXAML language features (completion, previewer, metadata caching) plus supporting .NET language server components and a solution parser.

Languages / Tech:
- TypeScript client (extension) under `src/vscode-axaml`
- C# (.NET 9 target where applicable) language server under `src/AxamlLSP`
- C# solution parser tool under `src/SolutionParser`
- Build tooling: dotnet SDK 9+, npm, vsce, esbuild, TypeScript.

Key folders:
- `src/vscode-axaml` – VS Code extension sources (TS in `src`, compiled to `out`)
- `src/AxamlLSP/AxamlLanguageServer` – language server entrypoint
- `src/SolutionParser` – CLI that emits solution model JSON
- `output/` – packaged VSIX artifacts

## Build & Validate
Always ensure dependencies installed.
1. Install Node deps: (run once) `npm install` inside `src/vscode-axaml` or use root script `npm install` if present.
2. Build .NET projects: `dotnet build src/AxamlLSP/AxamlLSP.sln -c Release` (packaging script builds needed bits automatically).
3. Compile extension (dev): `npm run compile` (outputs to `out/`).
4. Package extension: from repo root run `./package.sh` (rebuilds server & parser, bundles with esbuild, creates VSIX in `output/`).
5. Optionally install locally: `code --install-extension output/vscode-axaml-<version>.vsix`.

## Release Steps
1. Read current version in `src/vscode-axaml/package.json`.
2. Bump patch (unless instructed otherwise) and update CHANGELOG (`src/vscode-axaml/CHANGELOG.md`) with date `DD Month YYYY` and highlights/fixes.
3. Run `./package.sh` to produce new VSIX.
4. If requested: commit (`chore(release): vX.Y.Z`), tag `vX.Y.Z`, push, then `vsce publish`.
5. Remove placeholders in CHANGELOG before publishing.

## Conventions
- Keep newest CHANGELOG entry at top; blank line before/after headings.
- Use minimal logging; verbose mode only when troubleshooting (`axaml.verboseLogs`).
- Prefer patch releases for small fixes.

## Common Commands
- Rebuild solution model: command palette `AXAML: Rebuild solution model` or triggers on file changes (debounced).
- Invalidate metadata cache: `AXAML: Invalidate AXAML metadata cache` (clears temp metadata JSON).

## Troubleshooting
- If extension fails to activate: check `Output` -> `AXAML Client` channel logs.
- Solution discovery picks the shallowest `.slnx`/`.sln` file; falls back to workspace root.
- Parser spawns `SolutionParser.dll` using resolved `dotnet` runtime path.

## Safety
- Do not delete or move build scripts (`build.sh`, `package.sh`) without instruction.
- Do not force-publish or overwrite existing git tags.

## Scope
These instructions are general, not task-specific. Ask user when version bump size (minor/major) is unclear.
