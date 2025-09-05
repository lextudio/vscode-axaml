using System;
using System.Collections.Generic;
using Avalonia.Ide.CompletionEngine;

namespace AvaloniaLanguageServer.Utilities;

/// <summary>
/// Outline helper built on top of XmlParser's public surface (minimal additions: ElementNameStart, Step()).
/// Generates start/self-closing and closing tag events; skips comments / declarations / CDATA implicitly
/// because those regions never produce normal StartElement -> None cycles with IsInClosingTag relevant.
/// </summary>
internal static class XmlOutlineHelper
{
    public readonly record struct OutlineEvent(
        bool IsStart,
        bool IsSelfClosing,
        string TagName,
        int TagStart,
        int NameStart,
        int NameEnd,
        int TagEnd,
        bool IsClosing,
        Dictionary<string, string>? Attributes);

    public static IEnumerable<OutlineEvent> Enumerate(string? text)
    {
        if (string.IsNullOrEmpty(text)) yield break;
        var parser = new XmlParser(text.AsMemory());

        int? currentTagStart = null;
        int nameStart = -1;
        bool isClosing = false;
        bool suppressed = false; // comment / declaration / cdata

        // Track previous state manually (not exposed), infer transitions via sentinel capture
        var prevState = parser.State;
        while (parser.ParseChar())
        {
            var state = parser.State;
            // Detect start tag boundary
            if (state == XmlParser.ParserState.StartElement && prevState != XmlParser.ParserState.StartElement)
            {
                currentTagStart = parser.ContainingTagStart; // start '<'
                nameStart = parser.ElementNameStart; // may contain '/' if closing
                isClosing = parser.IsInClosingTag;
                suppressed = false;
            }

            // Suppression detection: immediately after StartElement if we enter special regions
            if (!suppressed && currentTagStart.HasValue && prevState == XmlParser.ParserState.StartElement &&
                (state == XmlParser.ParserState.InsideComment || state == XmlParser.ParserState.InsideDeclaration || state == XmlParser.ParserState.InsideCdata))
            {
                suppressed = true;
            }

            // Detect end of tag when returning to None
            if (state == XmlParser.ParserState.None && currentTagStart.HasValue)
            {
                int tagEnd = parser.ParserPos - 1; // '>' position
                if (isClosing)
                {
                    int closingNameStart = nameStart + 1; // skip '/'
                    int closingNameEnd = ScanNameTokenEnd(text, closingNameStart);
                    if (closingNameEnd > closingNameStart)
                    {
                        if (!suppressed)
                        {
                            string tagName = text.Substring(closingNameStart, closingNameEnd - closingNameStart);
                            yield return new OutlineEvent(false, false, tagName, currentTagStart.Value, closingNameStart, closingNameEnd, tagEnd, true, null);
                        }
                    }
                }
                else
                {
                    int startNameStart = nameStart;
                    int startNameEnd = GetNameEnd(parser, text, startNameStart);
                    if (!suppressed)
                    {
                        string tagName = text.Substring(startNameStart, startNameEnd - startNameStart);
                        bool selfClosing = startNameEnd <= tagEnd && tagEnd > startNameStart && tagEnd - 1 < text.Length && text[tagEnd - 1] == '/';
                        var attrs = ExtractAttributes(text, currentTagStart.Value, tagEnd);
                        yield return new OutlineEvent(true, selfClosing, tagName, currentTagStart.Value, startNameStart, startNameEnd, tagEnd, false, attrs);
                    }
                }
                currentTagStart = null;
            }

            prevState = state;
        }
    }

    // Lightweight attribute extraction for start tag region
    private static Dictionary<string, string>? ExtractAttributes(string text, int tagStart, int tagEnd)
    {
        // Only scan between '<Tag ... >', skip tag name
        int i = tagStart;
        while (i < tagEnd && text[i] != '<') i++;
        i++; // skip '<'
        while (i < tagEnd && char.IsWhiteSpace(text[i])) i++;
        // Skip tag name
        while (i < tagEnd && !char.IsWhiteSpace(text[i]) && text[i] != '/' && text[i] != '>') i++;
        var attrs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        while (i < tagEnd)
        {
            while (i < tagEnd && char.IsWhiteSpace(text[i])) i++;
            int keyStart = i;
            while (i < tagEnd && (char.IsLetterOrDigit(text[i]) || text[i] == ':' || text[i] == '-' || text[i] == '.')) i++;
            int keyEnd = i;
            if (keyEnd == keyStart) break;
            string key = text.Substring(keyStart, keyEnd - keyStart);
            while (i < tagEnd && char.IsWhiteSpace(text[i])) i++;
            if (i < tagEnd && text[i] == '=')
            {
                i++;
                while (i < tagEnd && char.IsWhiteSpace(text[i])) i++;
                char quote = i < tagEnd ? text[i] : '\0';
                if (quote == '"' || quote == '\'')
                {
                    i++;
                    int valueStart = i;
                    while (i < tagEnd && text[i] != quote) i++;
                    int valueEnd = i;
                    string value = text.Substring(valueStart, valueEnd - valueStart);
                    attrs[key] = value;
                    if (i < tagEnd && text[i] == quote) i++;
                }
                else
                {
                    // Unquoted value (rare)
                    int valueStart = i;
                    while (i < tagEnd && !char.IsWhiteSpace(text[i]) && text[i] != '/' && text[i] != '>') i++;
                    int valueEnd = i;
                    string value = text.Substring(valueStart, valueEnd - valueStart);
                    attrs[key] = value;
                }
            }
            else
            {
                // Attribute without value (rare)
                attrs[key] = "";
            }
        }
        return attrs.Count > 0 ? attrs : null;
    }

    private static int GetNameEnd(XmlParser parser, string s, int start)
    {
        // If ElementNameEnd already known
        if (parser.ElementNameEnd.HasValue)
            return parser.ElementNameEnd.Value + 1;
        return ScanNameTokenEnd(s, start);
    }

    private static int ScanNameTokenEnd(string s, int start)
    {
        int i = start;
        while (i < s.Length)
        {
            char c = s[i];
            if (char.IsWhiteSpace(c) || c == '/' || c == '>') break;
            i++;
        }
        return i;
    }
}
