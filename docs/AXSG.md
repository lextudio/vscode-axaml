# AXSG Integration

## Overview

The `vscode-axaml` extension bundles a client integration for AXSG (XamlToCSharpGenerator) for the **editing experience only** (language server features). Preview/designer integration is out of scope right now before they stabilize.

The extension's AXSG client implementation is derived from the upstream helper at `src/XamlToCSharpGenerator/tools/vscode/axsg-language-server` and maintained under `src/vscode-axaml`.

## Integration flow

- **Client source**: [src/vscode-axaml/src/axsgClient.ts](src/vscode-axaml/src/axsgClient.ts)
- **Upstream reference**: [src/XamlToCSharpGenerator/tools/vscode/axsg-language-server/extension.js](src/XamlToCSharpGenerator/tools/vscode/axsg-language-server/extension.js)
- **Packaged runtime**: the AXSG server DLL is packaged under `src/vscode-axaml/axsgServer` and discovered by [src/vscode-axaml/src/runtimeManager.ts](src/vscode-axaml/src/runtimeManager.ts).

## Custom LSP requests

The extension invokes these custom LSP requests for editing features:

- `axsg/metadataDocument`
- `axsg/inlineCSharpProjections`
- `axsg/csharp/references`
- `axsg/csharp/declarations`
- `axsg/csharp/renamePropagation`
- `axsg/refactor/prepareRename`
- `axsg/refactor/rename`

> Note: `axsg/preview/projectContext` exists in the upstream helper's preview-support.js but is **not** used by `vscode-axaml` (preview is out of scope).

## Packaging & runtime selection

The extension looks for a local `axsgServer` folder and `XamlToCSharpGenerator.LanguageServer.dll` (see [src/vscode-axaml/src/runtimeManager.ts](src/vscode-axaml/src/runtimeManager.ts)). If upstream packaging or file names change, update `runtimeManager.ts` accordingly.

## Sync checklist (when upgrading AXSG)

When a new AXSG release lands, compare **`axsgClient.ts`** against **`extension.js`** in the upstream helper:

1. Verify custom LSP **method names** still match between `axsgClient.ts` and `extension.js`.
2. Verify **request payload shapes** (field names, structure) for all `axsg/*` calls.
3. Verify **response field names** (`text`, `id`, `xamlRange`, `projectedCodeRange`, `projectedText`, `kind`, `range`, `placeholder`, workspace edit shape).
4. Confirm **packaged server layout** and update `runtimeManager.ts` if DLL names or folder structure changed.
5. Run extension smoke tests (inline projections, cross-language references, rename flows).

## Quick verification steps

1. Start a VS Code development host with the `vscode-axaml` extension.
2. Trigger an inline C# projection (calls `axsg/inlineCSharpProjections`) and verify results.
3. Test cross-language go-to-references and go-to-declaration (`axsg/csharp/references`, `axsg/csharp/declarations`).
4. Test cross-language rename flows (`axsg/refactor/rename`).

If behavior differs, inspect the extension output channel `AXSG Language Server` and compare request/response JSON with the upstream helper.

## Where to look for differences

- **Payload serialization**: check JSON field names and numeric types in both `axsgClient.ts` and `extension.js`.
- **Binary / packaging**: changed DLL names or folder layout require updates in `runtimeManager.ts`.

## References

- AXSG client (extension): [src/vscode-axaml/src/axsgClient.ts](src/vscode-axaml/src/axsgClient.ts)
- Upstream helper: [src/XamlToCSharpGenerator/tools/vscode/axsg-language-server/extension.js](src/XamlToCSharpGenerator/tools/vscode/axsg-language-server/extension.js)
- Runtime manager: [src/vscode-axaml/src/runtimeManager.ts](src/vscode-axaml/src/runtimeManager.ts)

---

Update this document if upstream request names, response shapes, or packaging layout change.
