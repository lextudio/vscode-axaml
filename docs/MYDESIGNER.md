# MyDesigner Codebase Analysis: File | Open Menu Flow

This document traces the complete flow of what happens when a user clicks **File | Open** in the MyDesigner application, from the UI menu through to file loading and document creation.

---

## High-Level Overview

```
User clicks "File | Open" menu
    ↓
MainWindow.axaml MenuItem → OpenCommand binding
    ↓
MainWindowViewModel.OpenCommand (RelayCommand)
    ↓
Shell.Instance.Open() [no-arg async version]
    ↓
MainWindow.AskOpenFileName() [file picker dialog]
    ↓
User selects file → returns path
    ↓
Shell.Instance.Open(string path) [with-arg version]
    ↓
File loaded and Document created
    ↓
CurrentDocument set → UI updates
```

---

## Detailed Component Walkthrough

### 1. UI Layer: Menu Definition

**File:** `MainWindow.axaml`

The File menu is defined in the XAML markup:

```xml
<MenuItem Header="File">
    <MenuItem Header="New" Command="{Binding NewCommand}" InputGesture="Ctrl+N" />
    <MenuItem Header="Open" Command="{Binding OpenCommand}" InputGesture="Ctrl+O" />
    <Separator />
    <MenuItem Header="Close" Command="{Binding CloseCommand}" InputGesture="Ctrl+W" />
    <MenuItem Header="Close All" Command="{Binding CloseAllCommand}" />
    <Separator />
    <MenuItem Header="Save" Command="{Binding SaveCommand}" InputGesture="Ctrl+S" />
    <MenuItem Header="Save As" Command="{Binding SaveAsCommand}" InputGesture="Ctrl+Shift+S" />
    <MenuItem Header="Save All" Command="{Binding SaveAllCommand}" />
    <Separator />
    <MenuItem Header="Recent Files" ItemsSource="{Binding RecentFiles}">
        <MenuItem.ItemTemplate>
            <DataTemplate>
                <MenuItem Header="{Binding}" 
                          Command="{Binding $parent[Window].((vm:MainWindowViewModel)DataContext).OpenRecentFileCommand}"
                          CommandParameter="{Binding}" />
            </DataTemplate>
        </MenuItem.ItemTemplate>
    </MenuItem>
    <Separator />
    <MenuItem Header="Exit" Command="{Binding ExitCommand}" InputGesture="Alt+F4" />
</MenuItem>
```

**Key Points:**
- The Open menu item is bound to `{Binding OpenCommand}`
- Keyboard shortcut is `Ctrl+O` (also defined in Window.KeyBindings)
- DataContext is set to `MainWindowViewModel`

---

### 2. ViewModel Layer: Command Binding

**File:** `MainWindowViewModel.cs`

The ViewModel wires the UI command to the Shell:

```csharp
public partial class MainWindowViewModel : ViewModelBase
{
    public MainWindowViewModel()
    {
        // ... other initialization ...
        
        // Subscribe to Shell property changes
        Shell.Instance.PropertyChanged += Shell_PropertyChanged;
        
        // Initialize commands
        InitializeCommands();
    }

    private void InitializeCommands()
    {
        // File Commands
        NewCommand = new RelayCommand(Shell.Instance.New);
        OpenCommand = new RelayCommand(Shell.Instance.Open);  // ← Binds to no-arg Shell.Open()
        SaveCommand = new RelayCommand(Shell.Instance.SaveCurrentDocument, () => Shell.Instance.CurrentDocument != null);
        // ... more commands ...
    }

    public RelayCommand OpenCommand { get; private set; }
}
```

**Key Points:**
- `OpenCommand` is a `RelayCommand` from `CommunityToolkit.Mvvm`
- It directly invokes `Shell.Instance.Open()` (the no-argument version)
- The command is exposed as a public property for XAML binding

---

### 3. Shell: File Picker Dialog

**File:** `Shell.cs` (async no-arg version)

When the menu item is clicked, the parameterless `Open()` method is invoked:

```csharp
public async void Open()
{
    var path = await MainWindow.Instance?.AskOpenFileName();
    if (path != null)
    {
        Open(path);
    }
}
```

**Flow:**
1. Calls `MainWindow.Instance.AskOpenFileName()` asynchronously
2. If user selects a file (path is not null), calls the path-based `Open(string path)` method
3. If user cancels, nothing happens

**Design Note:** The method is `async void` (unusual pattern, but acceptable here since it's a UI event):
- It doesn't return a Task to the caller
- The UI thread remains responsive while awaiting the file picker dialog

---

### 4. File Picker Implementation

**File:** `MainWindow.axaml.cs`

The actual file picker dialog is implemented using Avalonia's StorageProvider:

```csharp
public async System.Threading.Tasks.Task<string> AskOpenFileName()
{
    try
    {
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Open XAML File",
            AllowMultiple = false,
            FileTypeFilter = new[]
            {
                new FilePickerFileType("XAML Files")
                {
                    Patterns = new[] { "*.xaml" }
                },
                new FilePickerFileType("All Files")
                {
                    Patterns = new[] { "*.*" }
                }
            }
        });

        return files?.FirstOrDefault()?.Path.LocalPath;
    }
    catch (Exception ex)
    {
        Shell.ReportException(ex);
        return null;
    }
}
```

**Key Features:**
- Shows a native file open dialog
- Allows selection of `.xaml` files or any file type
- Uses Avalonia's cross-platform storage provider
- Returns the local file path (or null if canceled)
- Catches and reports exceptions via `Shell.ReportException()`

---

### 5. Shell: Document Opening and Creation

**File:** `Shell.cs` (path-based version)

Once the file path is obtained, `Open(string path)` is called:

```csharp
public void Open(string path)
{
    try
    {
        System.Diagnostics.Debug.WriteLine($"[Shell.Open] Called with path: {path}");
        path = Path.GetFullPath(path);
        System.Diagnostics.Debug.WriteLine($"[Shell.Open] Full path: {path}");

        _recentFilesService.AddFile(path);

        // Check if document is already open
        foreach (var doc in Documents)
        {
            if (doc.FilePath == path)
            {
                System.Diagnostics.Debug.WriteLine($"[Shell.Open] Document already open, setting as current");
                CurrentDocument = doc;
                return;
            }
        }

        // Create new document
        System.Diagnostics.Debug.WriteLine($"[Shell.Open] Creating new document");
        var newDoc = new Document(path);
        Documents.Add(newDoc);
        System.Diagnostics.Debug.WriteLine($"[Shell.Open] Setting CurrentDocument (Documents.Count={Documents.Count})");
        CurrentDocument = newDoc;
        System.Diagnostics.Debug.WriteLine($"[Shell.Open] Success. CurrentDocument={CurrentDocument?.Title}");
    }
    catch (Exception ex)
    {
        ReportException(ex);
    }
}
```

**Detailed Steps:**

1. **Normalize path:** Convert to absolute path using `Path.GetFullPath()`
2. **Track recently opened:** Add file to `_recentFilesService` for Recent Files menu
3. **Check if already open:**
   - Iterate through `Documents` collection
   - If a document with the same `FilePath` exists, set it as `CurrentDocument` and return
   - This prevents duplicate documents for the same file
4. **Create new Document:** If not already open:
   - Instantiate `new Document(path)`
   - Add to `Documents` collection (ObservableCollection)
   - Set as `CurrentDocument` (this triggers property change notifications)
5. **Exception handling:** Wrap all operations in try/catch and call `ReportException()`

**Key Properties Affected:**
- `CurrentDocument` (ObservableProperty) → triggers UI updates
- `Documents` (ObservableCollection) → updates document tabs
- Title bar updates via binding to `CurrentDocument.Title`

---

### 6. Document Creation and File Loading

**File:** `Document.cs`

When `new Document(path)` is called, the constructor triggers file loading:

```csharp
public Document(string filePath) : this(Path.GetFileNameWithoutExtension(filePath), "")
{
    FilePath = filePath;
    ReloadFile();
}

private void ReloadFile()
{
    try
    {
        if (File.Exists(FilePath))
        {
            Text = File.ReadAllText(FilePath);
            UpdateDesign();
            IsDirty = false;
        }
    }
    catch (Exception ex)
    {
        Shell.ReportException(ex);
    }
}
```

**Steps:**

1. **Constructor call chain:**
   - `Document(string filePath)` calls the chained constructor `Document(string tempName, string text)`
   - Passes the base filename (without extension) and empty text

2. **Set FilePath property:**
   - Triggers property change notifications for `FilePath`, `FileName`, `Title`, `Name`

3. **Read file from disk:**
   - `ReloadFile()` checks if file exists
   - Reads entire file content via `File.ReadAllText()`
   - Sets `Text` property

4. **Parse and design the XAML:**
   - Calls `UpdateDesign()` which:
     - Creates an XML reader from the XAML text
     - Creates a `XamlLoadSettings` object
     - Calls `DesignSurface.LoadDesigner(xmlReader, loadSettings)`
     - Creates a `XamlDesignContext` which parses the XAML
     - If parsing succeeds, sets `OutlineRoot` (tree view in UI)
     - If parsing fails, captures errors in `XamlErrorService.Errors`

5. **Mark as clean:**
   - Sets `IsDirty = false` (file just loaded, no unsaved changes)

---

### 7. XAML Parsing and Error Collection

**File:** `DesignSurface.cs` (indirectly through Document)

When `DesignSurface.LoadDesigner()` is called:

```csharp
public void LoadDesigner(XmlReader xamlReader, XamlLoadSettings loadSettings)
{
    UnloadDesigner();
    loadSettings = loadSettings ?? new XamlLoadSettings();
    loadSettings.CustomServiceRegisterFunctions.Add(context =>
        context.Services.AddService(typeof(IDesignPanel), _designPanel));
    InitializeDesigner(new XamlDesignContext(xamlReader, loadSettings));
}
```

The `XamlDesignContext` constructor (in `XamlDesignContext.cs`) performs the actual parsing:

```csharp
public XamlDesignContext(XmlReader xamlReader, XamlLoadSettings loadSettings)
{
    // Register services including XamlErrorService
    var xamlErrorService = new XamlErrorService();
    Services.AddService(typeof(XamlErrorService), xamlErrorService);
    Services.AddService(typeof(IXamlErrorSink), xamlErrorService);

    // Parse the XAML document
    ParserSettings = new XamlParserSettings();
    ParserSettings.TypeFinder = loadSettings.TypeFinder;
    ParserSettings.ServiceProvider = Services;
    Document = XamlParser.Parse(xamlReader, ParserSettings);

    // Report any parsing errors
    loadSettings.ReportErrors(xamlErrorService);

    // Create root design item from parsed XAML
    if (Document != null)
    {
        _rootItem = _componentService.RegisterXamlComponentRecursive(Document.RootElement);
    }
}
```

**Key Flow:**

1. **Error Service Registration:**
   - `XamlErrorService` is registered in the `Services` container
   - Implements `IXamlErrorSink` interface

2. **XAML Parsing:**
   - `XamlParser.Parse()` is called with the XML reader
   - Parser encounters elements and attributes
   - If a type cannot be found (e.g., `vm:MainWindowViewModel`), `ReportError()` is called
   - If markup extension is unknown (e.g., `BindingExtension`), error is reported
   - Errors are collected in `XamlErrorService.Errors` (ObservableCollection)

3. **Document Object Model:**
   - If parsing succeeds, a `XamlDocument` is created
   - `XamlObject` hierarchy is built from the parsed XML
   - `_rootItem` (a `DesignItem`) represents the root control in the designer

4. **UI Reflection:**
   - Errors appear in the designer's **Errors panel** (bound to `XamlErrorService.Errors`)
   - The design surface shows the parsed layout (or shows blank if root failed)

---

## Related Features

### Recent Files Menu

**File:** `Shell.cs` → `_recentFilesService.AddFile(path)`

When a file is opened:
1. Path is added to `RecentFilesService`
2. Recent files list is persisted (in app settings)
3. Menu items are auto-generated in the XAML:
   ```xml
   <MenuItem Header="Recent Files" ItemsSource="{Binding RecentFiles}">
       <MenuItem.ItemTemplate>
           <DataTemplate>
               <MenuItem Header="{Binding}" 
                         Command="{Binding $parent[Window].((vm:MainWindowViewModel)DataContext).OpenRecentFileCommand}"
                         CommandParameter="{Binding}" />
           </DataTemplate>
       </MenuItem.ItemTemplate>
   </MenuItem>
   ```
4. Clicking a recent file invokes `OpenRecentFileCommand` → `Shell.Instance.Open(filePath)`

### Keyboard Shortcut: Ctrl+O

**File:** `MainWindow.axaml`

```xml
<Window.KeyBindings>
    <KeyBinding Gesture="Ctrl+O" Command="{Binding OpenCommand}" />
</Window.KeyBindings>
```

Pressing `Ctrl+O` triggers the same `OpenCommand` as the menu item.

### Drag & Drop Support

**File:** `MainWindow.axaml.cs`

```csharp
private void OnDrop(object sender, DragEventArgs e)
{
    if (e.Data.Contains(DataFormats.Files))
    {
        var files = e.Data.GetFiles();
        if (files != null)
        {
            ProcessPaths(files.Select(f => f.Path.LocalPath));
        }
    }
}

private void ProcessPaths(IEnumerable<string> paths)
{
    foreach (var path in paths)
    {
        if (path.EndsWith(".xaml", StringComparison.InvariantCultureIgnoreCase))
        {
            Shell.Instance.Open(path);
        }
    }
}
```

Users can drag `.xaml` files onto the window → calls `Shell.Instance.Open(path)`

---

## Data Flow Summary

| Component | Responsibility |
|-----------|-----------------|
| **Menu/MainWindow.axaml** | UI definition; declares Open menu item with command binding |
| **MainWindowViewModel** | Wires the UI command to `Shell.Instance.Open()` method |
| **MainWindow.axaml.cs** | Provides file picker dialog via `AskOpenFileName()` |
| **Shell.cs** | Orchestrates file opening; manages document lifecycle |
| **RecentFilesService** | Tracks and persists recently opened files |
| **Document.cs** | Represents an open document; triggers file read and parsing |
| **DesignSurface.cs** | Host for the XAML design context |
| **XamlDesignContext** | Owns the XAML parser and error collection service |
| **XamlErrorService** | Collects parsing errors in `ObservableCollection<XamlError>` |
| **XamlParser** | Parses XML/XAML and invokes error sink on failures |

---

## Error Handling and Diagnostics

When errors occur during file opening or parsing:

1. **File I/O Errors:**
   - Caught in `Document.ReloadFile()`
   - Reported via `Shell.ReportException()` → error dialog

2. **XAML Parsing Errors:**
   - Caught by `XamlParser` and reported to `IXamlErrorSink` (implemented by `XamlErrorService`)
   - Errors include:
     - "Cannot find type {name}" (unknown class)
     - "Unknown markup extension {name}Extension"
     - Line and column information
   - Collected in `XamlErrorService.Errors` ObservableCollection
   - Displayed in the **Errors panel** UI

3. **Exception Propagation:**
   - Most errors are caught locally and reported
   - If critical errors occur, the document loads but the design surface remains empty/blank

---

## Integration with Designer Server (VS Code Extension)

The File | Open flow is leveraged by the VS Code integration:

1. **From VS Code Extension:**
   - Extension calls `IntegrationServer.startSession(filePath, assemblyPaths[])`

2. **In Designer Host (Program.cs):**
   - Callback `onOpenFile` is invoked with the file path
   - Calls `Shell.Instance.Open(filePath)` once Shell is initialized

3. **Diagnostics Collection:**
   - After file opens, `XamlErrorService.Errors` contains any parsing errors
   - Errors are streamed back to VS Code as `{ type: "diagnostic", ... }` JSON messages
   - Extension displays diagnostics in Problems panel and editor

---

## Summary

The **File | Open** flow in MyDesigner is a clean MVVM architecture:

1. **UI Layer** → Menu/KeyBindings bind to ViewModel commands
2. **ViewModel Layer** → Commands delegate to Shell methods
3. **Shell (Presenter)** → Shows file picker dialog, manages document lifecycle
4. **Model Layer** → Document reads file, triggers XAML parsing
5. **Parser Layer** → XamlParser and XamlDesignContext parse XML and collect errors
6. **Data Binding** → ObservableCollections and ObservableProperties update the UI reactively

This design enables:
- **Reusability:** `Shell.Open(path)` can be called from menu, keyboard shortcut, drag-drop, or remote (designer server)
- **Error Visibility:** Parsing errors are collected in an observable service and displayed in the UI
- **Session Management:** Multiple documents can be open; File | Open can add new documents or switch to existing ones

