# VSCode Tools for AXAML from LeXtudio Inc.

[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/lextudio.vscode-axaml?label=Version)](https://marketplace.visualstudio.com/items?itemName=lextudio.vscode-axaml)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lextudio.vscode-axaml?label=Installs)](https://marketplace.visualstudio.com/items?itemName=lextudio.vscode-axaml)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/lextudio.vscode-axaml?label=Downloads)](https://marketplace.visualstudio.com/items?itemName=lextudio.vscode-axaml)

[Avalonia](https://github.com/AvaloniaUI/Avalonia/) is a cross-platform XAML-based UI framework providing a flexible styling system and supporting a wide range of Operating Systems such as Windows via .NET Framework and .NET Core, Linux via Xorg and macOS. It uses AXAML format, which is a variant of XAML.

This Visual Studio Code Extension contains support for AXAML like autocompletion, live previewer, document outlines, etc.

Avalonia is a registered trademark of AvaloniaUI OÜ. This extension is independent and unaffiliated with Avalonia.

## History

This repository is a fork of the original Avalonia for VS Code extension by Avalonia UI. Our goal is to actively maintain and enhance the developer experience in Visual Studio Code by:

- Keeping the extension up to date with new Avalonia releases
- Improving performance, reliability, and cross‑platform behavior
- Adding new productivity features (outline view, visual designer, smarter completion, diagnostics, etc.)
- Responding to community feedback and accelerating fixes

Issues and feature requests are welcome—your input helps shape the roadmap.

Follow the [contribution guide](CONTRIBUTING.md) if you want to help us build the extension.

## Getting Started

### Recommended Companion Extension

For consistent formatting of your AXAML files, we recommend optionally installing the community **XAML Styler** extension (`dabbinavo.xamlstyler`). The first time you use this extension you'll receive a prompt; you can also find it manually in the Extensions view by searching for "XAML Styler". This extension is optional—the AXAML features work without it.

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

### XAML Code completion

Rich syntax highlighter and contextual code completion will make it lot easier to read and write AXAML files

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

### Language servers

- Default: the extension now uses the `XamlToCSharpGenerator` (AXSG) language server by default. AXSG focuses specifically on AXAML workflows and offers improved completion, inline C# projections, and tighter previewer integration.
- Files targeted: the extension and AXSG are scoped to AXAML files only (file type `axaml`). They do not activate on generic `xaml` files.
- To change the server: set `axaml.languageServer` to either `XamlToCSharpGenerator` or `AxamlLanguageServer` in your settings.
- To point to a custom server binary or DLL, set `axaml.languageServerPath` to an absolute path; this overrides the `axaml.languageServer` selection.

> NOTE: [AXSG language server](https://github.com/wieslawsoltes/XamlToCSharpGenerator) is created by Wiesław Šoltés, and released under MIT license. Axaml language server created by AvaloniaUI is not recommended but can be turned on if needed.
>
> NOTE: AXSG language server is still an early preview. It might report many warnings (in AXSG0111 category or others). Please ignore them, or report directly to [this repo](https://github.com/wieslawsoltes/XamlToCSharpGenerator/issues).

---

Copyright (c) 2023 AvaloniaUI  
Copyright (c) 2025-2026 LeXtudio Inc.  
Copyright (c) 2026 Wiesław Šoltés
