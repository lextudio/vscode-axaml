# Change Log

## [11.0.52] - 5 September 2025

Highlights:

- Outline now shows control names, content, and key attributes, with improved classification and icons.
- Long names/content are truncated for readability;

## [11.0.51] - 26 August 2025

Highlights:

- Minor improvements on preview error handling and look and feel.

## [11.0.50] - 24 August 2025

Highlights:

- Added preview loading indicator.

## [11.0.49] - 24 August 2025

Highlights:

- Event-driven previewer update logic.

## [11.0.48] - 21 August 2025

Fixes:

- Resolved the language server path.

## [11.0.47] - 20 August 2025

Fixes:

- Removed an autocompletion assembly resolution option.

## [11.0.46] - 20 August 2025

Fixes:

- Selected project cache issue fixed.

## [11.0.45] - 20 August 2025

Fixes:

- Revised language server binary bundle.

## [11.0.44] - 20 August 2025

Fixes:

- Fixed an issue with invalid solution cache due to new AXAML files.
- Fixed an issue with activation that blocks new project command.

## [11.0.43] - 20 August 2025

Highlights:

- Documentation and trademark compliance further improved.

## [11.0.42] - 19 August 2025

Highlights:

- Extension name and description updated for Avalonia trademark compliance. Attribution added.
- Project selection and asset generation split into separate commands for clarity and user control.
- Language status item now shows selected project and allows re-selection.

## [11.0.41] - 17 August 2025

Highlights:

- Extension and parser now robustly handle multi-targeting and AvaloniaXaml asset discovery.
- Status bar refactored to show project and solution information.

## [11.0.40] - 17 August 2025

Highlights:

- Refresh button in previewer menubar now uses iframe reloads.

## [11.0.39] - 16 August 2025

Highlights:

- SolutionParser now supports `<TargetFrameworks>` and logs warnings for unsupported targets.

## [11.0.38] - 15 August 2025

Highlights:

- Improved completion and status bar icon.

## [11.0.37] - 15 August 2025

Highlights:

- Added previewer scale controls.

## [11.0.36] - 15 August 2025

Fixes:

- Revised previewer to work with Avalonia 11.3.3 on macOS.

## [11.0.35] - 15 August 2025

Fixes:

- Updated language server to run on .NET 9 and removes .NET 8 dependency.

## [11.0.34] - 14 August 2025

Fixes:

- Fixed invalid JS regex /^(?i:WinExe|Exe)$/ causing extension activation crash.

## [11.0.33] - 14 August 2025

Highlights:

- Cached XAML metadata (with invalidate command) for faster cold start.
- New commands: show chosen executable project; invalidate metadata cache.
- Better assembly resolution (workspace root passed) and updated docs/logging.
- Other performance improvements.

## [11.0.32] - 14 August 2025

Fixes:

- Added AXAML outline support.

## [0.0.27] - 18 January 2024

Fixes:

- VSCode Extension v0.0.26 still not working [#89](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/89)
- SolutionParser is crashed and previewer is not loaded correctly [#86](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/86)

## [0.0.26] - 03 January 2024

Fixes:

- Can't get past "Build the project first." [#81](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/81)
- Problem with dotnet version dependency [#77](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/77)


## [0.0.25] - 27 November 2023

Fixes:

- AXAML intellisense in VS Code broken [#66](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/66)
- ALWAYS: Previewer is not available. Build the project first. [#72](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/72)
- [ERROR] dotnet build exited with code 1 [#68](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/68)
- Preview not working, vscode Linux [#58](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/58)
- Previewer not working in Linux. [#61](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/61)

## [0.0.24] - 16 November 2023

Fixed the blocker issue [#65](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/65)

## [0.0.22] - 25 October 2023

### Changes

- Fixes: Previewer does not work in the v0.0.21 [#63](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/63)

## [0.0.21] - 25 October 2023

### Notable Changes (0.0.21)

- feat: Add C# snippet for Avalonia AttachedProperty, DirectProperty, StaticProperty by @workgroupengineering in [#59](https://github.com/AvaloniaUI/AvaloniaVSCode/pull/59)
- Fixes warnings by @workgroupengineering in [#60](https://github.com/AvaloniaUI/AvaloniaVSCode/pull/60)

### New Contributors

- @workgroupengineering made their first contribution in [#59](https://github.com/AvaloniaUI/AvaloniaVSCode/pull/59)

**Full Changelog**: [v0.0.20...v0.0.21](https://github.com/AvaloniaUI/AvaloniaVSCode/compare/v0.0.20...v0.0.21)

## [0.0.20] - 9 October 2023

### Notable Changes (0.0.20)

- Fix the mouse interaction in previewer by @prashantvc in [#56](https://github.com/AvaloniaUI/AvaloniaVSCode/pull/56)
- Improve indentation by @prashantvc in [#57](https://github.com/AvaloniaUI/AvaloniaVSCode/pull/57)

**Full Changelog**: [v0.0.19...v0.0.20](https://github.com/AvaloniaUI/AvaloniaVSCode/compare/v0.0.19...v0.0.20)

## [0.0.19] - 13 September 2023

### Notable Changes (0.0.19)

- Allow users to create a new project from VSCode by @prashantvc in [#47](https://github.com/AvaloniaUI/AvaloniaVSCode/pull/47)
- Previewer Window Title does not update on tab switch by @prashantvc in [#50](https://github.com/AvaloniaUI/AvaloniaVSCode/pull/50)

**Full Changelog**: [v0.0.18...v0.0.19](https://github.com/AvaloniaUI/AvaloniaVSCode/compare/v0.0.18...v0.0.19)
 
## [0.0.18] - 08 September 2023

### Notable Fixes (0.0.18)

- Extension not activating #39
- Extension fails to launch child process if VS Code path has spaces #41


## [0.0.17] - 01 September 2023

### Notable Fixes (0.0.17)

- Previewer is blank, it does not get update until focus change. [Issue #8](https://github.com/AvaloniaUI/Avalonia-VSCode-Extension/issues/8)
- Previewer doesn't work when opened from command palette. [Issue #5](https://github.com/AvaloniaUI/Avalonia-VSCode-Extension/issues/5)

## [0.0.13] - 25 August 2023

- Fixes the issue where extension fails to work when on .NET preview releases

## [0.0.11] - 24 August 2023

- Improve the XAML previewer performance
- Support Avalonia xplat solution

### Known Issues (0.0.11)

1. Previewer may take up to 10 seconds to activate for the first time if you’re using Avalonia `v0.10.*`
2. You must build the project before using the previewer
3. Previewer may not be visible first time; switch to XAML code tab or save the file

## [0.0.6] - 03 August 2023

- Improved code completion

## [0.0.4] - 25 July 2023

- Code completion will not work for files with `\n` as newline chars [#23](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/23)
- Set higher/lower limit for previewer [#18](https://github.com/AvaloniaUI/AvaloniaVSCode/issues/18)

## [0.0.3] - 19 July 2023

- Fixed the issue where `Show preview` command is available for all `xml` files (issue #15)
- Previewer now shows the preview from the active `axaml` file (issue #19)

### Known Issues (0.0.3)

- Previewer may take over 5 seconds to render if you're using Avalonia 0.10.*
- Auto complete my crash for large files

## [0.0.2] - 12 July 2023

- Offers previewer zoom in/out functionality
- Previewer now has grid background
- Previewer changes background based on VS Code theme

### Known Issues

- Previewer will not update when you switch between `axaml` files

## [0.0.1]

- Initial release
- Offers XAML auto-complete
- Offers Basic XAML Previewer

### Known issues

- Extension works when only Avalonia project in the workspace
- You cannot zoom-in or out previewer panel
- Auto-complete lists duplicate items
