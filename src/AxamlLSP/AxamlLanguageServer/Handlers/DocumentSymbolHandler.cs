using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AvaloniaLanguageServer.Models;
using AvaloniaLanguageServer.Utilities;
using Microsoft.Extensions.Logging;
using OmniSharp.Extensions.LanguageServer.Protocol.Document;
using OmniSharp.Extensions.LanguageServer.Protocol.Models;
using OmniSharp.Extensions.LanguageServer.Protocol.Server.Capabilities;

namespace AvaloniaLanguageServer.Handlers;

/// <summary>
/// Provides a hierarchical outline for .axaml documents using a lightweight tag parser.
/// </summary>
public class DocumentSymbolHandler : DocumentSymbolHandlerBase
{
    /// <summary>
    /// Maximum length for label/content in outline. Can be changed for customization.
    /// </summary>
    public static int MaxLabelLength { get; set; } = 32;

    private readonly Workspace _workspace;
    private readonly DocumentSelector _documentSelector;
    private readonly ILogger<DocumentSymbolHandler> _logger;

    public DocumentSymbolHandler(Workspace workspace, DocumentSelector documentSelector, ILogger<DocumentSymbolHandler> logger)
    {
        _workspace = workspace;
        _documentSelector = documentSelector;
        _logger = logger;
    }

    protected override DocumentSymbolRegistrationOptions CreateRegistrationOptions(DocumentSymbolCapability capability, ClientCapabilities clientCapabilities)
    {
        return new DocumentSymbolRegistrationOptions
        {
            DocumentSelector = _documentSelector,
            Label = "Avalonia Document Symbols"
        };
    }

    public override Task<SymbolInformationOrDocumentSymbolContainer> Handle(DocumentSymbolParams request, CancellationToken cancellationToken)
    {
        var uri = request.TextDocument.Uri;
        var text = _workspace.BufferService.GetFullText(uri);
        if (text is null)
        {
            _logger.LogDebug("No buffer text for {Uri}", uri);
            return Task.FromResult(new SymbolInformationOrDocumentSymbolContainer());
        }
        var symbols = ParseDocumentSymbols(text);
        return Task.FromResult(new SymbolInformationOrDocumentSymbolContainer(symbols));
    }

    private IReadOnlyList<SymbolInformationOrDocumentSymbol> ParseDocumentSymbols(string text)
    {
        var lineStarts = BuildLineStartIndex(text);
        var roots = new List<Node>();
        var stack = new Stack<Node>();
        foreach (var ev in XmlOutlineHelper.Enumerate(text))
        {
            if (ev.IsStart)
            {
                if (string.IsNullOrWhiteSpace(ev.TagName))
                {
                    _logger.LogDebug("[DocSymbols] Skipping start tag with empty name at {Pos}", ev.TagStart);
                    continue;
                }
                var node = new Node
                {
                    TagName = ev.TagName,
                    Start = ev.TagStart,
                    NameTokenStart = ev.NameStart < 0 ? ev.TagStart : ev.NameStart,
                    NameTokenEnd = ev.NameEnd < 0 || ev.NameEnd < ev.NameStart ? (ev.NameStart < 0 ? ev.TagStart + ev.TagName.Length : ev.NameStart + ev.TagName.Length) : ev.NameEnd,
                    End = ev.TagEnd,
                    Attributes = ev.Attributes
                };
                if (ev.IsSelfClosing)
                    AttachNode(node, stack, roots);
                else
                    stack.Push(node);
            }
            else if (ev.IsClosing)
            {
                if (string.IsNullOrWhiteSpace(ev.TagName))
                {
                    _logger.LogDebug("[DocSymbols] Skipping closing tag with empty name at {Pos}", ev.TagStart);
                }
                while (stack.Count > 0)
                {
                    var node = stack.Pop();
                    node.End = ev.TagEnd;
                    AttachNode(node, stack, roots);
                    if (node.TagName == ev.TagName)
                        break;
                }
            }
        }
        while (stack.Count > 0)
            AttachNode(stack.Pop(), stack, roots);
        return roots.Select(r => (SymbolInformationOrDocumentSymbol)ToDocumentSymbol(r, lineStarts)).ToList();
    }

    private static void AttachNode(Node node, Stack<Node> stack, List<Node> roots)
    {
        if (stack.Count > 0) stack.Peek().Children.Add(node); else roots.Add(node);
    }

    private static List<int> BuildLineStartIndex(string text)
    {
        var list = new List<int> { 0 };
        for (int i = 0; i < text.Length; i++) if (text[i] == '\n') list.Add(i + 1);
        return list;
    }

    private static Position ToPosition(int index, List<int> lineStarts)
    {
        int line = lineStarts.BinarySearch(index);
        if (line < 0)
        {
            line = ~line - 1;
        }
        int character = index - lineStarts[line];
        return new Position(line, character);
    }

    private static DocumentSymbol ToDocumentSymbol(Node node, List<int> lineStarts)
    {
        var startPos = ToPosition(node.Start, lineStarts);
        var endPos = ToPosition(node.End, lineStarts);
        var selStart = ToPosition(node.NameTokenStart, lineStarts);
        var selEnd = ToPosition(node.NameTokenEnd, lineStarts);

        var kind = GuessKind(node.TagName);
        string displayName = node.TagName;
        string? detail = null;

        // Attribute-based label enhancement with truncation
        string Truncate(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            int maxLen = MaxLabelLength;
            return s.Length > maxLen ? s.Substring(0, maxLen) + "..." : s;
        }

        if (node.TagName.Contains('.'))
        {
            var idx = node.TagName.LastIndexOf('.');
            var typePart = node.TagName.Substring(0, idx);
            var propPart = node.TagName[(idx + 1)..];
            displayName = Truncate(propPart);
            detail = Truncate(typePart);
        }
        else if (node.Attributes != null)
        {
            // x:Name or Name
            if (node.Attributes.TryGetValue("x:Name", out var xname) && !string.IsNullOrWhiteSpace(xname))
                displayName += $" ({Truncate(xname)})";
            else if (node.Attributes.TryGetValue("Name", out var name) && !string.IsNullOrWhiteSpace(name))
                displayName += $" ({Truncate(name)})";
            // Content/Text/Header
            else if (node.Attributes.TryGetValue("Content", out var content) && !string.IsNullOrWhiteSpace(content))
                displayName += $" \"{Truncate(content)}\"";
            else if (node.Attributes.TryGetValue("Text", out var text) && !string.IsNullOrWhiteSpace(text))
                displayName += $" \"{Truncate(text)}\"";
            else if (node.Attributes.TryGetValue("Header", out var header) && !string.IsNullOrWhiteSpace(header))
                displayName += $" \"{Truncate(header)}\"";
            // Key/DataType for styles/templates
            if (node.Attributes.TryGetValue("x:Key", out var key) && !string.IsNullOrWhiteSpace(key))
                detail = detail == null ? $"Key: {Truncate(key)}" : detail + $", Key: {Truncate(key)}";
            if (node.Attributes.TryGetValue("DataType", out var dtype) && !string.IsNullOrWhiteSpace(dtype))
                detail = detail == null ? $"DataType: {Truncate(dtype)}" : detail + $", DataType: {Truncate(dtype)}";
            // Setter Property/Value
            if (node.TagName == "Setter")
            {
                if (node.Attributes.TryGetValue("Property", out var prop) && node.Attributes.TryGetValue("Value", out var val))
                    displayName += $" {Truncate(prop)}={Truncate(val)}";
            }
        }

        return new DocumentSymbol
        {
            Name = displayName,
            Kind = kind,
            Detail = detail,
            Range = new OmniSharp.Extensions.LanguageServer.Protocol.Models.Range
            {
                Start = startPos,
                End = endPos
            },
            SelectionRange = new OmniSharp.Extensions.LanguageServer.Protocol.Models.Range
            {
                Start = selStart,
                End = selEnd
            },
            Children = new Container<DocumentSymbol>(node.Children.Select(c => ToDocumentSymbol(c, lineStarts)))
        };
    }

    // Classification sets for AXAML element types
    private static readonly HashSet<string> LayoutControls = new(StringComparer.OrdinalIgnoreCase)
    {
        "Grid", "StackPanel", "DockPanel", "Border", "Canvas", "WrapPanel", "Panel"
    };
    private static readonly HashSet<string> InteractiveControls = new(StringComparer.OrdinalIgnoreCase)
    {
        "Button", "ToggleButton", "CheckBox", "RadioButton", "Slider", "MenuItem", "ComboBoxItem"
    };
    private static readonly HashSet<string> TextControls = new(StringComparer.OrdinalIgnoreCase)
    {
        "TextBlock", "TextBox", "Label"
    };
    private static readonly HashSet<string> CollectionControls = new(StringComparer.OrdinalIgnoreCase)
    {
        "ListBox", "ItemsControl", "ComboBox", "TreeView", "DataGrid"
    };
    private static readonly HashSet<string> MediaControls = new(StringComparer.OrdinalIgnoreCase)
    {
        "Image", "MediaElement"
    };
    private static readonly HashSet<string> TemplateElements = new(StringComparer.OrdinalIgnoreCase)
    {
        "Style", "ControlTemplate", "DataTemplate", "ItemsPanelTemplate"
    };
    private static readonly HashSet<string> ResourceElements = new(StringComparer.OrdinalIgnoreCase)
    {
        "ResourceDictionary"
    };

    private static SymbolKind GuessKind(string tagName)
    {
        if (tagName.Contains('.'))
            return SymbolKind.Property; // property element syntax
        if (LayoutControls.Contains(tagName))
            return SymbolKind.Module;
        if (InteractiveControls.Contains(tagName))
            return SymbolKind.Function;
        if (TextControls.Contains(tagName))
            return SymbolKind.String;
        if (CollectionControls.Contains(tagName))
            return SymbolKind.Array;
        if (MediaControls.Contains(tagName))
            return SymbolKind.File;
        if (TemplateElements.Contains(tagName))
            return SymbolKind.Interface;
        if (ResourceElements.Contains(tagName))
            return SymbolKind.Object;
        if (tagName.EndsWith("Window", StringComparison.OrdinalIgnoreCase) ||
            tagName.EndsWith("Control", StringComparison.OrdinalIgnoreCase) ||
            tagName.EndsWith("UserControl", StringComparison.OrdinalIgnoreCase) ||
            tagName.EndsWith("Page", StringComparison.OrdinalIgnoreCase) ||
            tagName.EndsWith("View", StringComparison.OrdinalIgnoreCase))
            return SymbolKind.Class;
        if (tagName.Equals("Setter", StringComparison.OrdinalIgnoreCase))
            return SymbolKind.Property;
        return SymbolKind.Object;
    }

    private class Node
    {
        public string TagName { get; set; } = string.Empty;
        public int Start { get; set; }
        public int End { get; set; }
        public int NameTokenStart { get; set; }
        public int NameTokenEnd { get; set; }
        public List<Node> Children { get; } = new();
        public Dictionary<string, string>? Attributes { get; set; }
    }
}
