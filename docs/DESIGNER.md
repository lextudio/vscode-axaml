Overview
--------

This document reviews the external MyDesigner visual designer (found under `src/MyDesigner`) and outlines practical integration points, an adapter API design, packaging and build suggestions, and a small proof-of-concept (PoC) scaffold plan for embedding the designer into the `vscode-axaml` extension.

The goal: enable VS Code users of the AXAML extension to open a WYSIWYG designer view for Avalonia/Axaml projects, reusing as much of the existing MyDesigner code and services as possible while keeping the extension lightweight and maintainable.

Summary of findings
-------------------

- The `src/MyDesigner` subtree contains a production-quality Win32/.NET desktop visual designer (MyDesigner.XamlDesigner). It is split into reusable library parts under `Libery` and an application host under `MyDesigner.XamlDesigner`.
- Key reusable libraries:
	- `MyDesigner.Design` — core design-time services (DesignContext, DesignItem, Services, Tools, Placement, Adorners, PropertyGrid, etc.). This is the primary integration target.
	- `MyDesigner.XamlDom` — XAML DOM and type metadata helpers, XAML parsing and design-time properties support. Useful for mapping between files in a workspace and the runtime visual tree used by the designer.
	- `MyDesigner.Designer` — higher-level UI components and metadata for the desktop app; contains the `DesignSurface` control and glue code used by the host.

Integration surface candidates
----------------------------

I considered four possible integration approaches, ordered by recommended starting point:

1) Language server + external desktop host (lowest friction)
	 - Keep the MyDesigner codebase as a separate desktop app (or service). Use the extension to communicate with it via an IPC channel (WebSocket, TCP, or stdio) or by launching the host with arguments.
	 - Benefits: minimal changes to existing MyDesigner; desktop process can host a full-featured WYSIWYG designer with native UI; LSP remains responsible for code intelligence.
	 - Integration points:
		 - Launching the host from the extension: `src/vscode-axaml/solutionParserTool` already contains tooling that the extension runs. Add a `--serve-port` or `--session` argument to `MyDesigner.XamlDesigner.exe` to listen for editor commands.
		 - File sync: extension watches workspace XAML files and forwards updates/edits to the desktop designer over the IPC channel.
		 - Commands API: the desktop host exposes commands: `openFile`, `selectElement`, `applyPropertyEdit`, `snapshotPreview`, `exportXaml`.

2) Embedded WebView or Electron/Browser UI (medium friction)
	 - Port or host the design surface inside a browser-like container using Avalonia's WebRenderer or by creating a lightweight headless designer service that renders images for the web view.
	 - Integration points:
		 - Expose a REST/WS endpoint in the designer process that returns serialized visual previews (images or svg) for the WebView.
		 - Use the extension's WebView panel to show the interactive surface; forward events from the WebView to the designer back-end.
	 - Tradeoffs: requires significant porting work or building a rendering bridge.

3) Language Server + Remote/Headless Design Engine (highest coupling)
	 - Integrate a headless design engine into the existing language server (`src/AxamlLSP/AxamlLanguageServer`). The server would host the DOM, metadata, and a rendering/export API used by the extension to show previews.
	 - Integration points:
		 - Add endpoints or LSP custom requests for design actions (e.g., `designer/open`, `designer/getPreview`, `designer/applyChange`).
		 - Reuse `MyDesigner.XamlDom` and `MyDesigner.Design` libraries by building them as .NET assemblies referenced by the server.
	 - Tradeoffs: server becomes heavier; cross-platform build concerns; may be appropriate if a headless design engine can be built from MyDesigner code.

4) Minimal adapter in the extension that performs model translation
	 - If the full designer is impractical, implement a reduced 'visualizer' that uses `MyDesigner.XamlDom` for parsing and presents a simplified tree/preview in a WebView.

Recommended starting approach
----------------------------

Start with option (1) — keep MyDesigner as a separate desktop process and implement an IPC-based command protocol that the extension uses. This minimizes changes to the MyDesigner code while delivering immediate value.

Why:
- Low risk: minimal code changes to the existing designer.
- Full feature parity possible by reusing the existing WYSIWYG UI.
- Faster to prototype and iterate; avoids cross-targeting Avalonia UI into Node/Electron or LSP complexity.

Detailed mapping: files and classes of interest
---------------------------------------------

Below are the most relevant files and classes I found (paths relative to repo root) and how they map to integration responsibilities.

- File: src/MyDesigner/Libery/MyDesigner.Design/DesignContext.cs — central service container and state manager for open documents and design sessions.
	- Use: The extension should be able to request session creation for a file; the desktop host can call into `DesignContext` to load the XAML and provide the live DOM.

- File: src/MyDesigner/Libery/MyDesigner.Design/DesignItem.cs — represents a node in the design-time tree.
	- Use: Represent selections and property edits. The IPC protocol can reference elements by a stable ID that maps to `DesignItem`.

- File: src/MyDesigner/Libery/MyDesigner.XamlDom/* — XAML parsing/runtime metadata.
	- Use: Shared parsing logic between server/extension/desktop host to ensure consistent type resolution.

- File: src/MyDesigner/MyDesigner.XamlDesigner/MainWindow.axaml / DesignSurface.axaml — host UI; contains the interactive design surface.
	- Use: The interactive surface remains in the desktop host; the extension can instruct it to focus elements or export screens.

- File: src/MyDesigner/Libery/MyDesigner.Design/Services/ServiceContainer.cs — service registration/resolution.
	- Use: Consider adding a specific `IExternalIntegrationService` that registers handlers for IPC messages, session lifecycle, and file synchronization.

Proposed IPC command protocol (sketch)
--------------------------------------

Use a JSON-over-WebSocket protocol (or a local TCP socket) with the following message shapes. All messages are JSON objects with `type`, `sessionId`, and `payload`.

- Request: `startSession` { filePath: string }
	- Response: `sessionStarted` { sessionId: string, rootId: string }

- Request: `openFile` { sessionId, filePath }
- Request: `selectElement` { sessionId, elementId }
- Request: `applyPropertyEdit` { sessionId, elementId, propertyName, value }
- Request: `getPreview` { sessionId, options }
	- Response: `preview` { imageData: base64, width, height }

- Notifications: `documentChanged` { sessionId, diffs } — sent by extension when user saves a XAML file.

Implementation strategy in the extension
----------------------------------------

1) Packaging and distribution
	 - Build the desktop designer as part of `package.sh` — expand packaging to include the built `MyDesigner.XamlDesigner` executable under `src/vscode-axaml/axamlServer` or `output/`.
	 - Provide launch helpers in the extension: on first use, the extension spawns the desktop process with an agreed port and waits for WebSocket handshake.

2) UI surface in VS Code
	 - Add a new WebView panel in `src/vscode-axaml/src` that hosts the designer control (image preview, selection inspector) and also acts as a control surface that forwards user actions to the desktop host.
	 - For full WYSIWYG, the desktop host is the interactive surface — extension simply embeds a remote frame (or shows a snapshot) and handles events via the IPC protocol.

3) File synchronization
	 - Use VS Code file watchers (existing extension code likely already has file watching) to detect saves and send `documentChanged` notifications to the desktop host.
	 - Optionally implement optimistic edits: when user modifies a property in the designer property editor, the extension applies the change via `applyPropertyEdit`, then optionally writes the XAML back to disk.

4) LSP integration points
	 - Wire editor selection -> design selection: when the user places cursor on a XAML element, the extension can call LSP to locate node ranges, then call the designer's `selectElement`.
	 - When the designer emits property edits, the extension should either send an LSP formatting/edits request or directly update the file contents and save.

Adapter API / Minimal API for MyDesigner
---------------------------------------

If we add a small integration service into `MyDesigner.Design`, it should expose the following C# API surface (internal or public) to reduce bespoke glue code in the host:

public interface IExternalIntegrationService
{
		Task<string> StartSessionAsync(string filePath);
		Task OpenFileAsync(string sessionId, string filePath);
		Task SelectElementAsync(string sessionId, string elementId);
		Task ApplyPropertyEditAsync(string sessionId, string elementId, string propertyName, string value);
		Task<byte[]> GetPreviewAsync(string sessionId, PreviewOptions options);
		event EventHandler<DocumentChangedEventArgs> DocumentChangedByHost;
}

Implementing this interface as a service makes wiring a WebSocket/TCP listener straightforward by adding a single service registration in `ServiceContainer`.

Packaging and build suggestions
-----------------------------

- Add a new target in `package.sh` to `dotnet publish` the `MyDesigner.XamlDesigner` project as a self-contained app (or framework-dependent with platform checks) per OS. Place artifacts under `output/` and include them in the VSIX if the user wants bundled designer.
- Alternatively provide a CLI wrapper in `src/vscode-axaml` that finds a locally installed MyDesigner executable (if user builds it themselves) and launches it.
- Update `src/vscode-axaml/package.json` with activation events and a command `axaml.openDesigner` that creates the WebView and handles handshake with the desktop host.

Proof-of-concept (PoC) scaffold
-------------------------------

Minimal tasks to land a working PoC quickly:

1. Add a tiny `IntegrationServer` class in `MyDesigner.Design` that listens on a WebSocket port and translates JSON requests to `IExternalIntegrationService` calls.
2. Add a CLI option to `MyDesigner.XamlDesigner` to start in server mode: `--serve --port 12345`.
3. In the extension, implement a `designerPanel.ts` that opens a WebView and attempts to connect via WebSocket to the host (or spawns the host if missing).
4. Implement `startSession` -> load file and return initial preview.

Estimated effort
----------------

- Minimal PoC (IPC + snapshot preview): 2-4 days of focused work, mostly in C# and extension WebView glue.
- Interactive design (full two-way UI): 1-2 weeks to iterate on event mapping and UX, depending on cross-platform packaging complexity.

Risks and considerations
-------------------------

- Cross-platform packaging: `MyDesigner.XamlDesigner` is a .NET desktop app presumably built for Windows/macOS/Linux via Avalonia. Ensure `dotnet publish` targets are configured for each OS.
- Security: only listen on localhost and use ephemeral ports. Consider simple token-based authentication for IPC.
- Performance: live preview updates may be expensive — prefer diffs or property-only updates over reloading full document where possible.
- Source-of-truth: decide whether designer edits write to disk immediately or produce suggested edits the user can accept.

Next steps (what I will do if you want me to continue)
----------------------------------------------------

- Implement the `IExternalIntegrationService` stub in `MyDesigner.Design` and add a WebSocket `IntegrationServer` that wires to `ServiceContainer`.
- Add `--serve` CLI mode to `MyDesigner.XamlDesigner` and update `package.sh` to publish server binaries into `src/vscode-axaml/axamlServer`.
- Add a minimal `designerPanel.ts` to the extension that spawns the host and shows a preview in a WebView.

Notes
-----

The above analysis is based on the provided MyDesigner folder structure and common patterns observed in the codebase. I focused on preserving existing design-time functionality and minimizing rework in the extension.

If you'd like, I can start with implementing the PoC `IntegrationServer` and a small `designerPanel.ts` in the extension now. Tell me whether you prefer the host bundled into the VSIX (simpler to use) or launched as a developer tool (smaller package size).

Designer requirements and what to provide from the extension
----------------------------------------------------------

To reliably render an AXAML/.xaml file inside the designer the following are required or strongly recommended:

- The XAML source file itself (the active `.axaml` file).
- The project compiled assembly (the project's output DLL) or a set of referenced assemblies that contain the CLR types used by the XAML. The designer must be able to resolve type names to CLR types.
- The `CurrentProjectAssemblyName` string so the parser and `x:Class`/type-resolution logic can use the correct assembly name.
- Optionally: `DesignerAssemblies` (assemblies that provide design-time editors/adorners) to register design extension types.

The extension should do one of the following before asking the designer to load a file:

1. Ensure the project is built and send the absolute paths of the produced DLL(s) (project DLL and referenced DLLs) to the designer; or
2. Provide custom `XamlTypeFinder` configuration to the designer that can resolve assemblies by probing the project output folders; or
3. Use a pre-configured assembly probing configuration in the designer host (less robust across user setups).

Message schema recommendation (extended for assemblies)
-----------------------------------------------------

Request `startSession` {
	filePath: string,
	projectAssemblyName?: string,
	assemblyPaths?: string[], // absolute DLL paths
	workingDirectory?: string
}

Response `sessionStarted` {
	sessionId: string,
	warnings?: string[]
}

Why pass `assemblyPaths`?
- Passing explicit DLL paths is the most predictable for `AssemblyLoadContext.Default.LoadFromAssemblyPath` or `Assembly.LoadFrom` and avoids reliance on global assembly probing or developer machine configuration.

Next implementation steps (what I will change now)
-----------------------------------------------

- Modify the PoC `IntegrationServer` to accept `assemblyPaths` in `startSession` and load them before calling into the design context creation.
- Expand the `ExternalIntegrationServiceStub` to try to load the provided assemblies and instantiate a `XamlDesignContext` with `XamlLoadSettings` that sets `CurrentProjectAssemblyName` and registers the loaded assemblies with the `TypeFinder`.
- Update the extension `openDesigner` command to resolve the nearest project output DLL (quick heuristic: find the `.csproj` and look under `bin/Debug` or `bin/Release`) and include `assemblyPaths` in the `startSession` message.

