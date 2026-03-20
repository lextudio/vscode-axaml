
# AXAML vs AXSG Comparison

## Language Servers — Codebase Comparison

Summary: both language servers are .NET language-server implementations shipped with the extension, but they differ in origin, architecture, dependencies, and responsibilities.

- **AXAML (AxamlLanguageServer)**
	- **Location (source):** [src/AxamlLSP/AxamlLanguageServer/Program.cs](src/AxamlLSP/AxamlLanguageServer/Program.cs#L1-L80)
	- **Packaging (extension):** [src/vscode-axaml/axamlServer](src/vscode-axaml/axamlServer)
	- **Implementation style:** OmniSharp.Extensions.LanguageServer-based C# project with explicit handlers (e.g. completion, hover, document symbol). See `CompletionHandler` for how completions are produced and resolved.
	- **Key responsibilities:** lightweight AXAML-focused features: buffer tracking, completion via `Avalonia.Ide.CompletionEngine`, document sync, symbols, hover, simple project metadata handling.
	- **Dependencies:** uses `OmniSharp.Extensions.LanguageServer`, `Avalonia.Ide.CompletionEngine`, Serilog, and a small set of supporting libs.
	- **Source availability:** full source is present in the repo (easy to inspect and modify).

- **AXSG (XamlToCSharpGenerator LanguageServer)**
	- **Location (packaged):** [src/vscode-axaml/axsgServer](src/vscode-axaml/axsgServer)
	- **Location (source):** [src/XamlToCSharpGenerator/src/XamlToCSharpGenerator.LanguageServer/Program.cs](src/XamlToCSharpGenerator/src/XamlToCSharpGenerator.LanguageServer/Program.cs#L1-L60)
	- **Runtime selection:** chosen by the extension via `getLanguageServerPath()` in [src/vscode-axaml/src/runtimeManager.ts](src/vscode-axaml/src/runtimeManager.ts#L1-L120); extension setting `axaml.languageServer` toggles between servers.
	- **Implementation style:** provided as pre-built/published assemblies (XamlToCSharpGenerator.LanguageServer and related DLLs). The folder contains Roslyn / MSBuild and many runtime assemblies indicating deeper project/compilation integration.
	- **Key responsibilities:** heavier-weight generator/workflow: appears tied to the Xaml→C# generation toolchain, uses Roslyn/MSBuild pieces and XamlToCSharpGenerator components to produce richer metadata, language services and possibly project-aware translations.
	- **Dependencies:** includes `Microsoft.Build.*`, `Microsoft.CodeAnalysis.*`, `XamlToCSharpGenerator.*` assemblies and many runtime libraries — larger runtime surface than AXAML.
	- **Source availability:** language server binaries are packaged here; source for XamlToCSharpGenerator lives in `XamlToCSharpGenerator/` (separate project in repo), but the extension ships the published artifacts.

- **Commonalities & integration**
	- Both are .NET-based language servers and the extension can run either.
	- Both are deployed under the extension (`axamlServer` and `axsgServer`) and `runtimeManager` chooses the appropriate binary.
	- Both provide LSP features (completion, hover, symbols), but they surface features differently based on underlying engines (AXAML uses `Avalonia.Ide.CompletionEngine`, AXSG uses the XamlToCSharpGenerator toolchain).

- **When to prefer each**
	- Use **AXAML** when you want the lightweight, easily-inspected server implemented in this repo and focused on common editing features.
	- Use **AXSG** when you need deeper project/model-aware generation and features backed by the XamlToCSharpGenerator toolchain (heavier, more dependencies, likely more accurate for complex projects).

If you want, I can:
- run a quick grep to list feature handlers implemented by each server,
- extract a dependency list for AXSG (from the `axsgServer` folder), or
- regenerate the `axamlServer` publish to compare exact binary sizes.

### Feature Comparison

| Feature | AXAML (AxamlLanguageServer) | AXSG (XamlToCSharpGenerator) |
| --- | --- | --- |
| Source (entry) | [src/AxamlLSP/AxamlLanguageServer/Program.cs](src/AxamlLSP/AxamlLanguageServer/Program.cs#L1-L80) | [src/XamlToCSharpGenerator/src/XamlToCSharpGenerator.LanguageServer/Program.cs](src/XamlToCSharpGenerator/src/XamlToCSharpGenerator.LanguageServer/Program.cs#L1-L60) |
| Packaging in extension | [src/vscode-axaml/axamlServer](src/vscode-axaml/axamlServer) | [src/vscode-axaml/axsgServer](src/vscode-axaml/axsgServer) |
| LSP transport / host | Built with OmniSharp.Extensions (C# LSP host in-process) | Standalone LSP tool executable (XamlToCSharpGenerator.LanguageServer / Tool) |
| Underlying engine | `Avalonia.Ide.CompletionEngine` and repo handlers (`CompletionHandler`, `HoverHandler`) | `XamlToCSharpGenerator.LanguageService` + Roslyn/MSBuild integration (project-aware semantic engine) |
| Key dependencies | OmniSharp.Extensions.LanguageServer, Serilog, Avalonia.Ide.CompletionEngine | Microsoft.Build.*, Microsoft.CodeAnalysis.*, XamlToCSharpGenerator.* assemblies |
| Completion | Yes — engine-backed, lightweight; initializes metadata from project assembly when available | Yes — richer, project/semantic-aware completions via language service |
| Hover / Quick info | Yes (standard handlers) | Yes (semantic, can include generated C# projection data) |
| Document symbols / outline | Yes (`DocumentSymbolHandler`, XmlOutlineHelper) | Yes (semantic model-driven symbols) |
| Go-to-definition / References / Rename | Basic go-to (file-level/project metadata dependent) | Full project-aware navigation, references, rename/refactor support via Roslyn integration |
| Semantic tokens | Not primary; basic syntax features provided | Supported (semantic engine provides richer tokens/semantic coloring) |
| Inline C# projection | No (focuses on AXAML editing) | Supported (projects show inline C# projection / mapping in some flows) |
| Code generation (XAML→C#) | Not core responsibility (editor assistance only) | Core capability (Xaml→C# generator toolchain integrated) |
| Project awareness | Limited (reads simple project metadata / assembly) | High (MSBuild/Roslyn-aware, works with full project model) |
| Footprint / startup | Lightweight, smaller binary set | Heavier — many assemblies, larger runtime requirements |
| Runtime requirements | .NET runtime (packaged .dll under `axamlServer`) | .NET runtime + MSBuild/Roslyn runtime pieces; recommended as installed tool or packaged `axsgServer` |
| Update path / extensibility | Source present in repo — easy to modify and rebuild | Packaged binaries shipped with extension; source available in `XamlToCSharpGenerator/` but typically published as artifacts |
| Typical use-case | Fast editor features for AXAML editing; easy to inspect and patch | Deep project-aware language service, codegen, and advanced refactor/navigation |

## Live previewer comparison

Summary: AXAML's previewer currently has broader compatibility and works for more projects via the editor's preview host. AXSG provides a richer, project-aware preview pipeline with selectable compiler modes and live preview support, but it typically works only for specially configured projects (source-generated runtime present or a configured previewer tool). The AXSG extension code contains preview helpers and logic in `tools/vscode/axsg-language-server/preview-utils.js` and the language service exposes preview project context via `XamlLanguageServiceEngine.GetPreviewProjectContextAsync` ([source](src/XamlToCSharpGenerator/src/XamlToCSharpGenerator.LanguageService/XamlLanguageServiceEngine.cs#L320-L440)).

| Preview Feature | AXAML (AxamlLanguageServer) | AXSG (XamlToCSharpGenerator) |
| --- | --- | --- |
| Supported preview modes | Broad support across many projects using the editor/bundled Avalonia preview host (works without special project config in many cases) | Multiple modes: `auto`, `avalonia`, `sourceGenerated` (selectable; auto resolves preferred mode) — typically requires project to be configured for source-generated or have a previewer tool path set |
| Live preview (hot reload) | Widely available when the editor preview host supports it; behavior varies by host (basic reload/hot-reload available for many projects) | Supported but conditional: requires the source-generated runtime marker or explicit project previewer configuration; otherwise live preview may not be available |
| Source-generated preview | Not part of the AXAML server — relies on Avalonia preview host or project-level previewing | Supported — detects runtime assembly or `.deps.json` to decide source-generated preview support (`supportsSourceGeneratedPreview`) and can detect live-preview marker (`supportsSourceGeneratedLivePreview`) |
| Preview host selection | Editor/extension picks bundled or external previewer; works for a broad set of projects without special config | Chooses ordered host paths (bundled designer host vs project previewer) and can prefer project previewer; uses `resolveAvaloniaPreviewerToolPaths` logic and often needs explicit project previewer tooling |
| Project detection for preview | Broad heuristics via extension/editor; successfully resolves many common project layouts | Requires project discovery and specific artifacts/configs; `GetPreviewProjectContextAsync` resolves owning project but preview availability depends on project configuration |
| Previewable project types | Works for many project types via the editor host | Intentionally checks package dependencies and others the previewer tool depends on (`isPreviewableProjectInfo`) |
| Security / loopback | Editor webviews handle security; works with standard editor workflows | Extracts preview security cookie from preview HTML and supports loopback target resolution (`extractPreviewSecurityCookie`, `resolveLoopbackPreviewWebviewTarget`) |
| Viewport & scaling | Basic scaling handled by editor host | Normalizes viewport metrics and render scale; maps client points to remote preview points (`preview-webview-helpers.js`) |
| Preview configuration keys | Editor/extension config (generic) | `axsg.preview.compilerMode`, `axsg.preview.targetPath`, project previewer tool path; runtime and project options resolved at runtime |
| Runtime requirements for preview | Depends on chosen host (editor/bundled previewer) | If using Avalonia host: Avalonia runtime; for source-generated: project's generated runtime assembly and .NET build artifacts; MSBuild may be invoked to build preview host artifacts |
| Fallback behavior | Editor often falls back to a broadly-compatible preview or simple render; works for more projects out-of-the-box | `auto` mode attempts robust fallback between source-generated and Avalonia host, but AXSG may still require bundled designer host or explicit project config to work |

Notes & sources:
- Preview mode and host selection logic: [tools/vscode/axsg-language-server/preview-utils.js](src/XamlToCSharpGenerator/tools/vscode/axsg-language-server/preview-utils.js#L1-L240)
- Preview project context resolution: [XamlLanguageServiceEngine.GetPreviewProjectContextAsync](src/XamlToCSharpGenerator/src/XamlToCSharpGenerator.LanguageService/XamlLanguageServiceEngine.cs#L320-L440)

If you'd like, I can also:
- extract the exact config keys and defaults used by the extension (`axsg.preview.*`), or
- add small examples showing how `axsg.preview.compilerMode` affects selection on a sample project.

