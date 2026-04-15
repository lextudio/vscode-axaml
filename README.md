# VSCode Tools for AXAML from LeXtudio Inc.

[![Become a Sponsor](https://img.shields.io/badge/Become%20a%20Sponsor-lextudio-orange.svg?style=for-readme)](https://github.com/sponsors/lextudio)
[![Version](https://vsmarketplacebadges.dev/version/lextudio.vscode-axaml.svg)](https://marketplace.visualstudio.com/items?itemName=lextudio.vscode-axaml)
[![Installs](https://vsmarketplacebadges.dev/installs-short/lextudio.vscode-axaml.svg)](https://marketplace.visualstudio.com/items?itemName=lextudio.vscode-axaml)
[![Downloads](https://vsmarketplacebadges.dev/downloads-short/lextudio.vscode-axaml.svg)](https://marketplace.visualstudio.com/items?itemName=lextudio.vscode-axaml)

[Avalonia](https://github.com/AvaloniaUI/Avalonia/) is a cross-platform XAML-based UI framework providing a flexible styling system and supporting a wide range of Operating Systems such as Windows via .NET Framework and .NET Core, Linux via Xorg and macOS. AXAML is a XAML variant used by this framework to define user interfaces in a declarative way.

This Visual Studio Code Extension contains support for AXAML language services, such as autocompletion, diagnostics, document outlines, as well as live previewer.

Avalonia is a registered trademark of AvaloniaUI OÜ. This extension is independent and unaffiliated with the company.

## History

This repository aims to transit developers toward the open source and modern AXSG tooling ecosystem, instead of maintaining a legacy language server and live previewer that are abandoned.

- Keeping the extension up to date with new open source Avalonia releases
- Improving performance, reliability, and cross‑platform behavior
- Adding new productivity features (outline view, visual designer, smarter completion, diagnostics, etc.)
- Responding to community feedback and accelerating fixes

Issues and feature requests are welcome. Your input helps shape the community roadmap.

Follow the [contribution guide](CONTRIBUTING.md) if you want to help us improve the extension.

## Getting Started

### Recommended Companion Extension

For consistent formatting of your AXAML files, we recommend optionally installing the community **XAML Styler** extension (`dabbinavo.xamlstyler`). The first time you use this extension you'll receive a prompt; you can also find it manually in the Extensions view by searching for "XAML Styler". This extension is optional—the AXAML features work without it.

The new AXSG tooling ecosystem has its own VS Code extension, but it is more focused on projects that already fully migrated to AXSG. This extension is focused on providing a smooth experience for users by providing both the legacy language server and live previewer, and for users who are still in the process of migrating.

### Create a new Avalonia project

You can create a new Avalonia project directly from the Visual Studio Code

![New Project](media/NewProject.png)

Additionally, you can create a project from the command line too, with the command:

    dotnet new avalonia.app -o MyApp

This will create a new folder called `MyApp` with your application files. You can install Avalonia project templates with following command, if you do not have them installed already:

    dotnet new install Avalonia.Templates

Finally open the MyApp folder in the VS Code, open any AXAML file to activate the extension and code completion.

> NOTE: You must build the project once to enable code completion.

### Enable Previewer

![Previewer](media/PreviewerRM.png)

After you load the project in the VS Code, you can click on Show Preview button on the editor toolbar (1)

The previewer will prompt you to build your project if needed.

The previewer will refresh when you switch between multiple xaml files, unlike Visual Studio for Windows or Rider, VS Code will reuse the single preview window.

- New: the previewer supports a DPI‑aware scaling mode that renders crisper UI previews. When `axaml.previewer.transportMode` is set to `tcp` (the default), the previewer sends raw pixel frames over a TCP channel and the extension renders them on a canvas using the editor's DPI settings for sharper, correctly scaled output. With your mouse, hold `Alt` and scroll on the preview canvas to adjust the zoom level.
- If you experience issues with embedded content or prefer the previewer's built‑in HTML server, set `axaml.previewer.transportMode` to `html` to embed the preview in an iframe instead.
- The legacy previewer is very likely to fail at initial startup due to bugs in the Avalonia previewer codebase. If you encounter a blank preview or errors, please close the preview and try again. You can also check the output channel for AXAML logs to see if there are any indicators of what went wrong. Once you fully migrate to the new AXSG tooling, you can switch to the new hot reload based previewer integration which should be more stable and provide a better experience.

### XAML Code completion

Semantic highlighting and context-aware code completion will make it lot easier to read and write AXAML files

![Code completion](media/AutoCompleteRM.png)

### XAML Outlines

The AXAML files in the VS Code are showed with document outlines, allowing you to collapse and expand sections of your AXAML files for better readability.

### Useful Commands

- `AXAML: Toggle verbose AXAML logs` (`axaml.toggleVerboseLogs`)
- `AXAML: Show preview` (`axaml.showPreviewToSide`)
- `AXAML: Create previewer assets` (`axaml.createPreviewerAssets`)
- `AXAML: Create a new Avalonia Project` (`axaml.newProject`)
- `AXAML: Show solution discovery info` (`axaml.showSolutionDiscoveryInfo`)
- `AXAML: Open solution model JSON` (`axaml.openSolutionModelJson`)

### Settings Highlights

- `axaml.completion.buildConfigurationPreference` – Preferred build configuration for completion (Debug / Release / Auto)
- `axaml.trace.verbose` – Enable verbose AXAML server side logs (assembly scanning, metadata fallback)
- `axaml.trace.server` – LSP protocol tracing (messages / verbose)
- `axaml.misc.suppressXamlStylerRecommendation` – Suppress prompt recommending XAML Styler extension
- `axaml.previewer.emitBinlog` – Emit MSBuild binary log when building previewer assets
- `axaml.previewer.runDotnetInfo` – Run 'dotnet --info' before building previewer assets
- `axaml.previewer.transportMode` – Previewer transport mode. Default is `tcp`: the previewer sends raw pixel frames over a TCP channel and the extension renders them on a canvas (provides crisper, DPI‑aware scaling). Set to `html` to embed the previewer's HTTP server in an iframe instead.

### More Details on Language Servers

- Default: the extension now uses the `XamlToCSharpGenerator` (AXSG) language server by default. AXSG focuses specifically on AXAML workflows and offers improved completion, inline C# projections, and tighter previewer integration.
- Files targeted: the extension and AXSG are scoped to AXAML files only (file type `axaml`). They do not activate on generic `xaml` files.
- To change the server: set `axaml.languageServer` to either `XamlToCSharpGenerator` or `AxamlLanguageServer` in your settings.
- To point to a custom server binary or DLL, set `axaml.languageServerPath` to an absolute path; this overrides the `axaml.languageServer` selection.

> NOTE: [AXSG language server](https://github.com/wieslawsoltes/XamlToCSharpGenerator) is created by Wiesław Šoltés, and released under MIT license. The legacy language server was deprecated by AvaloniaUI and is not recommended.
>
> NOTE: AXSG language server is still an early preview. It might experience instability such as
>
> - Report many warnings (in AXSG0111 category or others). Please ignore them.
> - Long delay before the first change to semantic highlighting and completion.
> - The experimental hot reload based previewer integration is disabled due to stability issues. Please use the existing TCP or HTML transport previewer integration instead.
>
> Please report any issues you encounter with AXSG and we will work with the AXSG team to address them.

#### Feature Comparison

This includes a short feature comparison between the two language servers shipped with the extension.

| Feature | AxamlLanguageServer | AXSG/XamlToCSharpGenerator (default) |
|---|---|---|
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
| Status | Stable | Early preview (expect warnings, some instability, etc.) |

### Release Notes

Detailed information can be found on [this page](https://marketplace.visualstudio.com/items/lextudio.vscode-axaml/changelog).

---

Copyright (c) 2023 AvaloniaUI  
Copyright (c) 2025-2026 LeXtudio Inc.  
Copyright (c) 2026 Wiesław Šoltés  
