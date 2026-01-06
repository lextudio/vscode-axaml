# VS Code Tools for AXAML Architecture

## Overview
VS Code Tools for AXAML is a cross-platform development environment for AXAML (Avalonia variant of XAML), providing rich language features in Visual Studio Code. It consists of a VS Code extension (`vscode-axaml`), a .NET-based language server, a solution parser, and supporting tooling. The architecture is modular, with clear separation between client (TypeScript/VS Code), server (C#/.NET), and solution/model parsing components.

## Main Components

### 1. VS Code Extension (`src/vscode-axaml`)
- **Language Features:** Syntax highlighting, auto completion, code navigation, and previewer integration for `.axaml` files.
- **Activation:** Registers commands, sets up the language client, and manages solution/model discovery.
- **Previewer:** Launches and manages a previewer process for live XAML rendering, communicating via TCP/WebSocket and custom messages.
- **Solution Model:** Uses a CLI parser to analyze the workspace and generate a solution model JSON, which is cached and used for context-aware features.
- **Status Bar:** Indicates readiness of completion metadata and previewer assets.

### 2. Language Server (`src/AxamlLSP/AxamlLanguageServer`)
- **Protocol:** Implements the Language Server Protocol (LSP) using OmniSharp.Extensions.LanguageServer.
- **Handlers:** Provides completion, hover, document sync, and symbol handlers for AXAML files.
- **Workspace Model:** Loads project/solution info, builds completion metadata, and manages buffer state.
- **Metadata Cache:** Reads solution model JSON and builds a metadata cache for fast completion and IntelliSense.
- **Logging:** Uses Serilog for verbose and error logging, configurable via client options.

### 3. Completion Engine (`src/AxamlVS/CompletionEngine`)
- **Core Logic:** Parses AXAML, selectors, and markup extensions to provide context-aware completion.
- **Metadata:** Loads and processes assembly metadata, including Avalonia specific types, properties, events, and resources.
- **Selector/Markup Parsing:** Custom parsers for selectors and markup extensions enable granular completion suggestions.
- **Hint Values:** Supplies property, resource, and pseudo-class hints for completion.

### 4. Previewer
- **Process Management:** The extension and server can launch a previewer process (dotnet executable) to render XAML live.
- **Communication:** Uses custom messages (BSON-encoded) over TCP/WebSocket to update XAML, DPI, and pixel formats.
- **Error Handling:** Reports errors and frame updates back to the extension for display.
- **UI Integration:** The previewer panel in VS Code displays the rendered output and responds to user interactions.

### 5. Solution Parser (`src/SolutionParser`)
- **CLI Tool:** Parses `.sln`/`.slnx` files and outputs a normalized JSON model of projects, assemblies, and dependencies.
- **Integration:** Invoked by the extension to keep the solution model up to date, enabling context-aware completion and previewing.

## Auto Completion Feature
- **Trigger:** Completion is triggered by typing in AXAML files, using both client-side and server-side logic.
- **Flow:**
  1. The extension sends a completion request to the language server.
  2. The server parses the buffer, loads metadata, and invokes the CompletionEngine.
  3. The CompletionEngine analyzes the context (element, attribute, selector, markup extension) and returns relevant suggestions.
  4. The server maps internal completion kinds to LSP item kinds and returns them to the client.
  5. The extension displays the completion list, with icons and documentation.
- **Metadata:** Completion is powered by a metadata cache built from the user's assemblies, including Avalonia specific types, attached properties, events, resources, and pseudo-classes.
- **Invalidation:** Metadata is rebuilt on solution changes or build events, ensuring up-to-date suggestions.

## Previewer Feature
### Previewer Parameter Mapping

| Previewer Parameter             | MSBuild Property Name              | Description / Usage                                      |
|---------------------------------|------------------------------------|----------------------------------------------------------|
| previewerPath                   | AvaloniaPreviewerNetCoreToolPath   | Path to Avalonia Designer Host DLL (previewer executable) |
| targetPath                      | TargetPath                         | Output DLL/EXE of the project                            |
| projectRuntimeConfigFilePath     | ProjectRuntimeConfigFilePath       | Path to .runtimeconfig.json for the project              |
| projectDepsFilePath              | ProjectDepsFilePath                | Path to .deps.json for the project                       |

### Process Management

- **Executable Name & Location:**
  - The previewer process is started using the .NET CLI (`dotnet`) and the path provided by `previewerParams.previewerPath`.
  - This path points to the Avalonia previewer .NET executable (DLL or EXE) built for the user's project, e.g., `MyApp.AvaloniaPreviewer.dll`.
  - The extension does not bundle a previewer executable; it references the user's built previewer via the solution model.

- **How the Process is Started:**
  - The extension spawns the previewer using:
    ```
    dotnet exec --runtimeconfig "<projectRuntimeConfigFilePath>" --depsfile "<projectDepsFilePath>" "<previewerPath>" --method avalonia-remote --transport tcp-bson://localhost:<bsonPort>/ --method html --html-url <htmlUrl> <targetPath>
    ```
  - All arguments are constructed in `previewerProcess.ts` and passed to the `dotnet` command.

- **Ports Used:**
  - The previewer uses two ports:
    - `httpPort`: For HTML preview (webview).
    - `bsonPort`: For TCP/BSON protocol communication (usually `httpPort + 1`).
  - Ports are dynamically assigned using the `portfinder` library.

### Custom BSON-Based Protocol

- **Protocol Details:**
  - Communication between the extension and the previewer process uses a custom protocol over TCP, with messages encoded in BSON.
  - The protocol is implemented in `messageParser.ts` and `previewServer.ts`.
  - Each message has:
    - A 4-byte length prefix.
    - A 16-byte message type GUID (after byte order adjustment).
    - BSON-encoded payload.

- **Message Types:**
  - Examples:
    - `startDesignerSessionMessageId`: Starts a designer session.
    - `clientRenderInfoMessageId`: Sends DPI info.
    - `clientSupportedPixelFormats`: Negotiates pixel formats.
    - `updateXamlId`: Updates the XAML content.
  - Messages are serialized/deserialized using the `bson` npm package.

- **How to Understand the Protocol:**
  - See `Messages` class in `messageParser.ts` for message construction and parsing.
  - The protocol is binary, with GUID-based message IDs and BSON payloads.
  - The extension and previewer process both implement the same message structure for interoperability.

## Solution Model & Metadata Cache
- **Discovery:** The extension discovers the shallowest solution file and invokes the parser to build a solution model.
- **Cache:** The language server and extension use the solution model to locate assemblies and build a metadata cache for completion and previewing.
- **Invalidation:** Commands are provided to rebuild the solution model and invalidate the metadata cache.

## Extensibility & Safety
## Additional Architectural Highlights

### Solution Discovery Logic
- The extension automatically discovers the shallowest `.sln` or `.slnx` file in the workspace.
- Fallback logic scans for project files if no solution is found.
- Enables context-aware features even in unconventional project layouts.

### Metadata Cache Invalidation
- Metadata cache is rebuilt on solution changes, build events, or explicit user commands.
- Ensures completion and previewer features are always up-to-date with the latest code and dependencies.

### Logging & Diagnostics
- Verbose logging can be toggled for troubleshooting.
- Logs are written to both the VS Code output channel and the language server (Serilog).
- Asset discovery, solution parsing, and previewer process management are all instrumented for diagnostics.

### Extensibility Points
- Custom commands for rebuilding the solution model, invalidating caches, and toggling verbose logs.
- Modular architecture makes it easy to add new language features or protocol handlers.

### Error Handling & Safety
- The extension and server handle missing assets, build failures, and protocol errors gracefully.
- Safety checks prevent accidental deletion or modification of build scripts and packaging logic.

### Protocol Design
- The previewer protocol is custom, binary, and BSON-based, with GUID message types.
- Efficient, extensible communication between VS Code and the previewer process.

### Multi-Platform Support
- Designed to work cross-platform (Windows, macOS, Linux).
- Path normalization and process management account for platform differences.

### Integration with Avalonia Ecosystem
- Solution parser and completion engine are aware of Avalonia-specific concepts (resources, selectors, pseudo-classes).
- Previewer process is tightly integrated with Avalonia’s designer host.

## SolutionParser Target Framework Handling

### Multi-targeting Support
SolutionParser now supports both `<TargetFramework>` and `<TargetFrameworks>` in project files:

- If `<TargetFramework>` is present, it is used for asset discovery.
- If `<TargetFrameworks>` is present, SolutionParser selects the first compatible .NET TPM (e.g., `net8.0`, `net9.0`).
- If no compatible .NET TPM is found, SolutionParser logs a warning and falls back to the first listed target framework, which may not be previewer-compatible.

This ensures previewer asset discovery works for multi-targeted projects and provides diagnostics for unsupported configurations.
## Summary
VS Code Tools for AXAML is architected for robust, context-aware AXAML development in VS Code, with deep integration between client, server, and solution model. Auto completion and previewer features are powered by rich metadata, custom parsers, and live process communication, delivering a modern and productive AXAML editing experience.
