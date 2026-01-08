Integration notes — MyDesigner server-mode
=========================================

This document records the design decisions, code changes, and integration notes related to "server mode" for MyDesigner (MyDesigner.XamlDesigner). Server mode is a headless/remote-friendly configuration that hides interactive UI elements and enables autosave while preserving core editing capabilities (notably undo).

Goals
-----
- When launched in server mode the designer should provide a minimal UI suitable for remote embedding or automation:
	- Hide Project Explorer and Errors panes.
	- Hide the application menu bar and toolbar.
	- Enable autosave on document edits (debounced) so external consumers receive up-to-date files.
	- Preserve undo/redo functionality for user-driven tooling that still requires edit history.

Canonical server flag
---------------------
- The authoritative server-mode switch is the static field `Program.IsServerMode` in `src/MyDesigner/MyDesigner.XamlDesigner/Program.cs`.
	- It is set during CLI parsing at startup (for example, when `--serve` or equivalent argument is passed to the executable).
	- All features that change behavior for server mode should read from this flag.

Summary of code changes
-----------------------
- Dock layout (hide Project Explorer and Errors):
	- File: `src/MyDesigner/MyDesigner.XamlDesigner/ViewModels/DockFactory.cs`
	- Change: `CreateLayout()` now checks `Program.IsServerMode` and excludes `ProjectExplorer` from the left dock and `Errors` from the bottom dock when server mode is enabled. This prevents those dockable views from being created/visible in the layout.

- Top-level UI visibility (menu bar and toolbar):
	- File: `src/MyDesigner/MyDesigner.XamlDesigner/ViewModels/MainWindowViewModel.cs`
	- Change: exposed an observable property `IsServerMode` (initialized as `Program.IsServerMode`) so XAML can bind to it.
	- File: `src/MyDesigner/MyDesigner.XamlDesigner/Views/InverseBooleanConverter.cs` (added)
	- File: `src/MyDesigner/MyDesigner.XamlDesigner/Views/MainView.axaml` (edits)
		- Added namespace mapping for `views` and a `StaticResource` for `InverseBooleanConverter`.
		- Bound `IsVisible` of menu and toolbar controls to `IsServerMode` using the inverse converter so menu and toolbar are hidden in server mode.

- Autosave (debounced):
	- File: `src/MyDesigner/MyDesigner.XamlDesigner/Project/Document.cs`
	- Change: Implemented a debounced autosave timer (1 second) that triggers `Save()` when `IsDirty` is set and `SettingsService.GetSetting("AutoSave", true)` returns true. Autosave only runs for documents with a non-null `FilePath` (no SaveAs automation for untitled docs).
	- Design note: Autosave intentionally does not clear or otherwise interfere with the undo stack — it merely persists current document text. This keeps edit history available for interactive undo operations.

- Consolidated server flag usage:
	- Removed ad-hoc `Shell.IsServerMode` usage and replaced references to use `Program.IsServerMode` directly. This reduces duplication and prevents inconsistent state between components.

Build and verification
----------------------
- After applying the changes, the `MyDesigner.XamlDesigner` project was rebuilt (Release, non-incremental). The build succeeded with warnings (roughly ~596 warnings). Key issues resolved during iteration were:
	- XAML parsing error due to an undeclared prefix `views` in `MainView.axaml` — fixed by adding `xmlns:views="clr-namespace:MyDesigner.XamlDesigner.Views"`.
	- AVLN3000 error caused by an invalid `UserControl.DataTemplates` entry containing a `MainWindowViewModel` instance — the invalid DataTemplates block was removed.
- The remaining warnings are mostly nullability and obsolete-API related and can be addressed separately; they do not block server-mode features.

Testing and runtime checks (recommended)
---------------------------------------
Run-time verification should include the following checks (I can run these for you if you'd like):

- Layout/UI checks (server vs normal):
	- Launch normal mode (no server flag). Verify `Project Explorer`, `Errors`, menu bar, and toolbar are visible.
	- Launch server mode (ex: `./MyDesigner.XamlDesigner --serve` or the CLI that sets `Program.IsServerMode`). Verify `Project Explorer` and `Errors` are not present in the dock layout and the top menu/toolbar are hidden.

- Autosave checks:
	- Open an existing document with a real `FilePath` and modify it. After ~1 second of inactivity verify the file on disk updates.
	- Open an untitled/unsaved document and verify autosave does not attempt to SaveAs (current behavior purposely skips autosave for untitled docs).

- Undo stack checks:
	- Perform a series of edits, let autosave persist, then issue Undo operations. Confirm the undo history is intact and behaves as before.

Integration notes and rationale
------------------------------
- Use `Program.IsServerMode` as single source of truth:
	- Having a single global flag reduces the risk of partial or inconsistent UI state across components.

- Hide panes at layout creation time rather than dynamically removing views at runtime:
	- Removing `Project Explorer` and `Errors` from `VisibleDockables` prevents those components from being instantiated and reduces surface area for server-mode bugs.

- Autosave design choices:
	- Debounced save (1s) reduces I/O churn while providing timely persistence for automation/hosted scenarios.
	- Respecting `FilePath != null` avoids unexpected prompts or save-as flows in headless modes.
	- Leaving undo intact ensures users or automation that still receives input can revert recent changes locally.

Potential follow-ups and TODOs
------------------------------
- Run automated or manual runtime verification in both modes (todo: execute and record results).
- Confirm the exact CLI flag / argument name used for server mode and document in this file. (Right now we assume a `--serve`-like flag sets `Program.IsServerMode`.)
- Optionally provide a configuration setting to force autosave behavior for untitled docs if automation requires it.
- Tidy up warnings gradually (nullability, obsolete APIs) to improve code health.

Files touched (high level)
-------------------------
- src/MyDesigner/MyDesigner.XamlDesigner/Program.cs
- src/MyDesigner/MyDesigner.XamlDesigner/ViewModels/DockFactory.cs
- src/MyDesigner/MyDesigner.XamlDesigner/ViewModels/MainWindowViewModel.cs
- src/MyDesigner/MyDesigner.XamlDesigner/Views/MainView.axaml
- src/MyDesigner/MyDesigner.XamlDesigner/Views/InverseBooleanConverter.cs
- src/MyDesigner/MyDesigner.XamlDesigner/Project/Document.cs

If you want, I can now:
- run the app in server mode and verify UI + autosave + undo interactively, or
- run a repo-wide search to ensure no remaining `Shell.IsServerMode` references exist, and/or
- record a short checklist of runtime test steps and expected outputs for CI.
