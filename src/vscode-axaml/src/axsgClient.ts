/**
 * AXSG Language Server client with rich middleware.
 *
 * Ported from XamlToCSharpGenerator/tools/vscode/axsg-language-server/extension.js
 * into the vscode-axaml host extension so that users get the full AXSG experience
 * (virtual document providers, inline-C# projections, cross-language navigation
 * and rename) without having to install a separate extension.
 */

import * as vscode from "vscode";
import * as lsp from "vscode-languageclient/node";
import { getDotnetRuntimePath, getLanguageServerPath } from "./runtimeManager";
import { logger } from "./util/utilities";
import type {
	AxsgLanguageService,
	CacheEntry,
	InlineCSharpProjection,
	InlineCSharpProjectionAtPosition,
	InlineCSharpProjectionCacheEntry,
	InlineCSharpProjectionResponse,
	InlineCSharpProjectionUriCacheEntry,
	MetadataDocumentResponse,
	PrepareRenameResponse,
	ProjectionUriParsed,
	ProtocolLocation,
	ProtocolRange,
	ProtocolWorkspaceEdit,
	ServerStartupDetails,
	StatusBarState,
} from "./axsgTypes";

// ── constants ────────────────────────────────────────────────────────

const AXSG_METADATA_SCHEME = "axsg-metadata";
const AXSG_SOURCELINK_SCHEME = "axsg-sourcelink";
const AXSG_INLINE_CSHARP_SCHEME = "virtualCSharp-axsg-inline";
const AXSG_REFACTOR_RENAME_KIND = vscode.CodeActionKind.RefactorRewrite.append("rename");
const VIRTUAL_LOADING_DOCUMENT_MIN_LINES = 256;
const VIRTUAL_LOADING_DOCUMENT_MIN_COLUMNS = 256;

// ── module state ─────────────────────────────────────────────────────

let client: lsp.LanguageClient | undefined;
let clientStartPromise: Promise<lsp.LanguageClient | undefined> | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let startupDetails: ServerStartupDetails | undefined;
let suppressCSharpRenameProvider = false;

// caches
const metadataDocumentCache = new Map<string, CacheEntry>();
const metadataUriSubscriptions = new Map<string, Set<string>>();
let metadataChangeEmitter: vscode.EventEmitter<vscode.Uri> | undefined;

const sourceLinkDocumentCache = new Map<string, CacheEntry>();
const sourceLinkUriSubscriptions = new Map<string, Set<string>>();
let sourceLinkChangeEmitter: vscode.EventEmitter<vscode.Uri> | undefined;

const inlineCSharpProjectionCache = new Map<string, InlineCSharpProjectionCacheEntry>();
const inlineCSharpProjectionFetches = new Map<string, Promise<InlineCSharpProjectionCacheEntry | undefined>>();
const inlineCSharpProjectionUriCache = new Map<string, InlineCSharpProjectionUriCacheEntry>();
const inlineCSharpPresenceCache = new Map<string, boolean>();
let inlineCSharpProjectionChangeEmitter: vscode.EventEmitter<vscode.Uri> | undefined;

// ── helpers: encoding ────────────────────────────────────────────────

function decodeQueryValue(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function encodeQueryValue(value: unknown): string {
	return encodeURIComponent(String(value ?? ""));
}

// ── helpers: virtual document padding ────────────────────────────────

function padVirtualLoadingDocument(text: string): string {
	const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
	const paddedLines = lines.map((line) =>
		line.length >= VIRTUAL_LOADING_DOCUMENT_MIN_COLUMNS
			? line
			: line + " ".repeat(VIRTUAL_LOADING_DOCUMENT_MIN_COLUMNS - line.length),
	);
	while (paddedLines.length < VIRTUAL_LOADING_DOCUMENT_MIN_LINES) {
		paddedLines.push(" ".repeat(VIRTUAL_LOADING_DOCUMENT_MIN_COLUMNS));
	}
	return `${paddedLines.join("\n")}\n`;
}

// ── helpers: position / range mapping ────────────────────────────────

function comparePositions(left: vscode.Position, right: vscode.Position): number {
	if (left.line !== right.line) {
		return left.line - right.line;
	}
	return left.character - right.character;
}

function containsPosition(range: vscode.Range, position: vscode.Position): boolean {
	return comparePositions(position, range.start) >= 0 && comparePositions(position, range.end) <= 0;
}

function offsetAt(text: string, position: vscode.Position): number {
	const normalizedText = String(text || "").replace(/\r\n/g, "\n");
	let line = 0;
	let character = 0;
	for (let index = 0; index < normalizedText.length; index++) {
		if (line === position.line && character === position.character) {
			return index;
		}
		if (normalizedText[index] === "\n") {
			line++;
			character = 0;
			if (line > position.line) {
				return index + 1;
			}
		} else {
			character++;
		}
	}
	return normalizedText.length;
}

function positionAt(text: string, offset: number): vscode.Position {
	const normalizedText = String(text || "").replace(/\r\n/g, "\n");
	const boundedOffset = Math.max(0, Math.min(offset, normalizedText.length));
	let line = 0;
	let character = 0;
	for (let index = 0; index < boundedOffset; index++) {
		if (normalizedText[index] === "\n") {
			line++;
			character = 0;
		} else {
			character++;
		}
	}
	return new vscode.Position(line, character);
}

function toVsCodeRange(range: ProtocolRange): vscode.Range {
	return new vscode.Range(
		range.start.line,
		range.start.character,
		range.end.line,
		range.end.character,
	);
}

function toVsCodeLocation(location: ProtocolLocation): vscode.Location | undefined {
	if (!location || typeof location.uri !== "string" || !location.range) {
		return undefined;
	}
	return new vscode.Location(vscode.Uri.parse(location.uri), toVsCodeRange(location.range));
}

function toProtocolPosition(position: vscode.Position): { line: number; character: number } {
	return { line: position.line, character: position.character };
}

// ── projection mapping ───────────────────────────────────────────────

function mapProjectedPositionToXamlPosition(
	sourceText: string,
	projection: InlineCSharpProjection,
	projectedPosition: vscode.Position,
): vscode.Position | undefined {
	const projectedCodeStart = offsetAt(projection.projectedText, projection.projectedCodeRange.start);
	const projectedCodeEnd = offsetAt(projection.projectedText, projection.projectedCodeRange.end);
	const projectedOffset = offsetAt(projection.projectedText, projectedPosition);
	if (projectedOffset < projectedCodeStart || projectedOffset > projectedCodeEnd) {
		return undefined;
	}
	const xamlCodeStart = offsetAt(sourceText, projection.xamlRange.start);
	return positionAt(sourceText, xamlCodeStart + (projectedOffset - projectedCodeStart));
}

function mapProjectedRangeToXamlRange(
	sourceText: string,
	projection: InlineCSharpProjection,
	projectedRange: vscode.Range,
): vscode.Range | undefined {
	const start = mapProjectedPositionToXamlPosition(sourceText, projection, projectedRange.start);
	const end = mapProjectedPositionToXamlPosition(sourceText, projection, projectedRange.end);
	if (!start || !end) {
		return undefined;
	}
	return new vscode.Range(start, end);
}

function mapXamlPositionToProjectedPosition(
	sourceText: string,
	projection: InlineCSharpProjection,
	xamlPosition: vscode.Position,
): vscode.Position | undefined {
	const xamlCodeStart = offsetAt(sourceText, projection.xamlRange.start);
	const xamlCodeEnd = offsetAt(sourceText, projection.xamlRange.end);
	const xamlOffset = offsetAt(sourceText, xamlPosition);
	if (xamlOffset < xamlCodeStart || xamlOffset > xamlCodeEnd) {
		return undefined;
	}
	const projectedCodeStart = offsetAt(projection.projectedText, projection.projectedCodeRange.start);
	return positionAt(projection.projectedText, projectedCodeStart + (xamlOffset - xamlCodeStart));
}

function mapProjectedCompletionRange(
	sourceText: string,
	projection: InlineCSharpProjection,
	range: any,
): any {
	if (!range) {
		return undefined;
	}
	if (range.inserting && range.replacing) {
		const inserting = mapProjectedRangeToXamlRange(sourceText, projection, range.inserting);
		const replacing = mapProjectedRangeToXamlRange(sourceText, projection, range.replacing);
		if (!inserting || !replacing) {
			return undefined;
		}
		return { inserting, replacing };
	}
	return mapProjectedRangeToXamlRange(sourceText, projection, range);
}

function mapProjectedTextEdits(
	sourceText: string,
	projection: InlineCSharpProjection,
	edits: vscode.TextEdit[] | undefined,
): vscode.TextEdit[] | undefined {
	if (!Array.isArray(edits) || edits.length === 0) {
		return undefined;
	}
	const mapped: vscode.TextEdit[] = [];
	for (const edit of edits) {
		if (!edit || !edit.range) {
			continue;
		}
		const mappedRange = mapProjectedRangeToXamlRange(sourceText, projection, edit.range);
		if (!mappedRange) {
			continue;
		}
		mapped.push(new vscode.TextEdit(mappedRange, typeof edit.newText === "string" ? edit.newText : ""));
	}
	return mapped.length > 0 ? mapped : undefined;
}

function mapProjectedCompletionItem(
	sourceText: string,
	projection: InlineCSharpProjection,
	item: vscode.CompletionItem,
): vscode.CompletionItem | undefined {
	if (!item) {
		return undefined;
	}
	const mappedRange = mapProjectedCompletionRange(sourceText, projection, (item as any).range);
	if ((item as any).range && !mappedRange) {
		return undefined;
	}
	if (mappedRange) {
		(item as any).range = mappedRange;
	}
	const mappedTextEdits = mapProjectedTextEdits(sourceText, projection, item.additionalTextEdits);
	if (Array.isArray(item.additionalTextEdits) && !mappedTextEdits) {
		delete (item as any).additionalTextEdits;
	} else if (mappedTextEdits) {
		item.additionalTextEdits = mappedTextEdits;
	}
	return item;
}

function mapProjectedHover(
	sourceText: string,
	projection: InlineCSharpProjection,
	hover: vscode.Hover,
): vscode.Hover | undefined {
	if (!hover) {
		return undefined;
	}
	if (!hover.range) {
		return hover;
	}
	const mappedRange = mapProjectedRangeToXamlRange(sourceText, projection, hover.range);
	if (!mappedRange) {
		return undefined;
	}
	return new vscode.Hover(hover.contents, mappedRange);
}

// ── location result helpers ──────────────────────────────────────────

function normalizeLocationResults(value: any): any[] {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value;
	}
	return [value];
}

function mapProjectedResultLocation(result: any): vscode.Location | undefined {
	if (!result) {
		return undefined;
	}
	// LocationLink form
	if (result.targetUri && result.targetRange) {
		const targetUri: vscode.Uri = result.targetUri;
		if (targetUri.scheme === AXSG_INLINE_CSHARP_SCHEME) {
			const projectionInfo = inlineCSharpProjectionUriCache.get(targetUri.toString());
			if (!projectionInfo) {
				return undefined;
			}
			const mappedRange = mapProjectedRangeToXamlRange(
				projectionInfo.sourceText,
				projectionInfo.projection,
				result.targetSelectionRange ?? result.targetRange,
			);
			if (!mappedRange) {
				return undefined;
			}
			return new vscode.Location(vscode.Uri.parse(projectionInfo.sourceUri), mappedRange);
		}
		return new vscode.Location(targetUri, result.targetSelectionRange ?? result.targetRange);
	}
	// Location form
	if (result.uri && result.range) {
		if (result.uri.scheme === AXSG_INLINE_CSHARP_SCHEME) {
			const projectionInfo = inlineCSharpProjectionUriCache.get(result.uri.toString());
			if (!projectionInfo) {
				return undefined;
			}
			const mappedRange = mapProjectedRangeToXamlRange(
				projectionInfo.sourceText,
				projectionInfo.projection,
				result.range,
			);
			if (!mappedRange) {
				return undefined;
			}
			return new vscode.Location(vscode.Uri.parse(projectionInfo.sourceUri), mappedRange);
		}
		return result;
	}
	return undefined;
}

function dedupeLocations(locations: (vscode.Location | undefined)[]): vscode.Location[] {
	const map = new Map<string, vscode.Location>();
	for (const location of locations) {
		if (!(location instanceof vscode.Location)) {
			continue;
		}
		const key = `${location.uri.toString()}::${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
		if (!map.has(key)) {
			map.set(key, location);
		}
	}
	return [...map.values()];
}

function hasCompletionItems(result: any): boolean {
	if (!result) {
		return false;
	}
	if (Array.isArray(result)) {
		return result.length > 0;
	}
	if (Array.isArray(result.items)) {
		return result.items.length > 0;
	}
	return false;
}

// ── metadata document provider ───────────────────────────────────────

function renderMetadataProjectionFallback(query: URLSearchParams): string {
	const kind = query.get("kind");
	if (kind === "type") {
		const fullTypeName = decodeQueryValue(query.get("type") || "Unknown.Type");
		const lastSeparator = fullTypeName.lastIndexOf(".");
		const namespaceName = lastSeparator > 0 ? fullTypeName.substring(0, lastSeparator) : "GlobalNamespace";
		const typeName = lastSeparator > 0 ? fullTypeName.substring(lastSeparator + 1) : fullTypeName;
		return `// AXSG metadata projection\n// Generated for external symbol navigation.\n\nnamespace ${namespaceName}\n{\n    public class ${typeName}\n    {\n    }\n}\n`;
	}
	if (kind === "property") {
		const ownerTypeName = decodeQueryValue(query.get("owner") || "Unknown.Type");
		const propertyName = decodeQueryValue(query.get("name") || "Property");
		const propertyTypeName = decodeQueryValue(query.get("type") || "object");
		const isAttached = (query.get("attached") || "").toLowerCase() === "true";
		const isSettable = (query.get("settable") || "").toLowerCase() === "true";
		const lastSeparator = ownerTypeName.lastIndexOf(".");
		const namespaceName = lastSeparator > 0 ? ownerTypeName.substring(0, lastSeparator) : "GlobalNamespace";
		const typeName = lastSeparator > 0 ? ownerTypeName.substring(lastSeparator + 1) : ownerTypeName;
		const setterSuffix = isSettable ? " set;" : "";
		const declaration = isAttached
			? `public static ${propertyTypeName} ${propertyName} { get;${setterSuffix} }`
			: `public ${propertyTypeName} ${propertyName} { get;${setterSuffix} }`;
		return `// AXSG metadata projection\n// Generated for external symbol navigation.\n\nnamespace ${namespaceName}\n{\n    public class ${typeName}\n    {\n        ${declaration}\n    }\n}\n`;
	}
	return "// AXSG metadata projection\n// No symbol details available.\n";
}

function trackMetadataUri(documentId: string, uri: vscode.Uri): void {
	let subscribers = metadataUriSubscriptions.get(documentId);
	if (!subscribers) {
		subscribers = new Set();
		metadataUriSubscriptions.set(documentId, subscribers);
	}
	subscribers.add(uri.toString());
}

function updateMetadataCacheAndNotify(documentId: string, state: CacheEntry["state"], text: string): void {
	metadataDocumentCache.set(documentId, { state, text });
	const subscribers = metadataUriSubscriptions.get(documentId);
	if (!subscribers || !metadataChangeEmitter) {
		return;
	}
	for (const uriString of subscribers) {
		try {
			metadataChangeEmitter.fire(vscode.Uri.parse(uriString));
		} catch {
			// Ignore malformed URI entries.
		}
	}
}

async function fetchAndCacheMetadataDocument(documentId: string, uri: vscode.Uri): Promise<void> {
	const cached = metadataDocumentCache.get(documentId);
	if (cached && cached.state !== "loading") {
		return;
	}
	const activeClient = await tryEnsureClientStarted();
	if (!activeClient) {
		updateMetadataCacheAndNotify(
			documentId,
			"error",
			renderMetadataProjectionFallback(new URLSearchParams(uri.query || "")),
		);
		return;
	}
	try {
		const response = await activeClient.sendRequest<MetadataDocumentResponse>("axsg/metadataDocument", {
			id: documentId,
		});
		if (!response || typeof response.text !== "string" || response.text.length === 0) {
			updateMetadataCacheAndNotify(
				documentId,
				"error",
				padVirtualLoadingDocument(renderMetadataProjectionFallback(new URLSearchParams(uri.query || ""))),
			);
			return;
		}
		updateMetadataCacheAndNotify(documentId, "ready", response.text);
	} catch {
		updateMetadataCacheAndNotify(
			documentId,
			"error",
			padVirtualLoadingDocument(renderMetadataProjectionFallback(new URLSearchParams(uri.query || ""))),
		);
	}
}

function renderMetadataDocument(uri: vscode.Uri): string {
	const query = new URLSearchParams(uri.query || "");
	const documentId = query.get("id");
	if (documentId) {
		const decodedDocumentId = decodeQueryValue(documentId);
		trackMetadataUri(decodedDocumentId, uri);
		const cached = metadataDocumentCache.get(decodedDocumentId);
		if (cached && cached.state !== "loading") {
			return cached.text;
		}
		if (!cached) {
			const loadingText = padVirtualLoadingDocument(renderMetadataProjectionFallback(query));
			metadataDocumentCache.set(decodedDocumentId, { state: "loading", text: loadingText });
			void fetchAndCacheMetadataDocument(decodedDocumentId, uri);
			return loadingText;
		}
		return cached.text;
	}
	return renderMetadataProjectionFallback(query);
}

// ── source-link document provider ────────────────────────────────────

function trackSourceLinkUri(sourceUrl: string, uri: vscode.Uri): void {
	let subscribers = sourceLinkUriSubscriptions.get(sourceUrl);
	if (!subscribers) {
		subscribers = new Set();
		sourceLinkUriSubscriptions.set(sourceUrl, subscribers);
	}
	subscribers.add(uri.toString());
}

function updateSourceLinkCacheAndNotify(sourceUrl: string, state: CacheEntry["state"], text: string): void {
	sourceLinkDocumentCache.set(sourceUrl, { state, text });
	const subscribers = sourceLinkUriSubscriptions.get(sourceUrl);
	if (!subscribers || !sourceLinkChangeEmitter) {
		return;
	}
	for (const uriString of subscribers) {
		try {
			sourceLinkChangeEmitter.fire(vscode.Uri.parse(uriString));
		} catch {
			// Ignore malformed URI entries.
		}
	}
}

async function fetchAndCacheSourceLinkDocument(sourceUrl: string): Promise<void> {
	const cached = sourceLinkDocumentCache.get(sourceUrl);
	if (cached && cached.state !== "loading") {
		return;
	}
	try {
		const response = await fetch(sourceUrl, {
			headers: { "User-Agent": "axsg-language-server" },
		});
		if (!response.ok) {
			const failure = padVirtualLoadingDocument(
				`// AXSG source-link projection\n// Failed to load source from ${sourceUrl}.\n// HTTP ${response.status} ${response.statusText}\n`,
			);
			updateSourceLinkCacheAndNotify(sourceUrl, "error", failure);
			return;
		}
		const text = await response.text();
		updateSourceLinkCacheAndNotify(sourceUrl, "ready", text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failure = padVirtualLoadingDocument(
			`// AXSG source-link projection\n// Failed to load source from ${sourceUrl}.\n// ${message}\n`,
		);
		updateSourceLinkCacheAndNotify(sourceUrl, "error", failure);
	}
}

function renderSourceLinkDocument(uri: vscode.Uri): string {
	const query = new URLSearchParams(uri.query || "");
	const encodedUrl = query.get("url");
	if (!encodedUrl) {
		return "// AXSG source-link projection\n// Missing source URL.\n";
	}
	const sourceUrl = decodeQueryValue(encodedUrl);
	trackSourceLinkUri(sourceUrl, uri);
	const cached = sourceLinkDocumentCache.get(sourceUrl);
	if (cached && cached.state !== "loading") {
		return cached.text;
	}
	if (!cached) {
		const loadingText = padVirtualLoadingDocument(
			`// AXSG source-link projection\n// Loading source from ${sourceUrl}...\n`,
		);
		sourceLinkDocumentCache.set(sourceUrl, { state: "loading", text: loadingText });
		void fetchAndCacheSourceLinkDocument(sourceUrl);
		return loadingText;
	}
	return cached.text;
}

// ── inline C# projection cache ──────────────────────────────────────

function isXamlDocument(document: vscode.TextDocument): boolean {
	return /*document?.languageId === "xaml" || */document?.languageId === "axaml";
}

function isCSharpDocument(document: vscode.TextDocument): boolean {
	return document?.languageId === "csharp";
}

function createInlineCSharpProjectionCacheKey(sourceUri: string, version: number): string {
	return `${sourceUri}::${version}`;
}

function documentMayContainInlineCSharp(document: vscode.TextDocument): boolean {
	if (!isXamlDocument(document)) {
		return false;
	}
	const cacheKey = createInlineCSharpProjectionCacheKey(document.uri.toString(), document.version ?? 0);
	const cached = inlineCSharpPresenceCache.get(cacheKey);
	if (typeof cached === "boolean") {
		return cached;
	}
	const text = document.getText();
	const containsInlineCSharp = text.includes("CSharp");
	inlineCSharpPresenceCache.set(cacheKey, containsInlineCSharp);
	return containsInlineCSharp;
}

function buildInlineCSharpProjectionUri(sourceUri: string, version: number, projectionId: string): vscode.Uri {
	const query = new URLSearchParams();
	query.set("sourceUri", encodeQueryValue(sourceUri));
	query.set("version", String(version));
	query.set("id", encodeQueryValue(projectionId));
	return vscode.Uri.from({
		scheme: AXSG_INLINE_CSHARP_SCHEME,
		authority: "axsg-inline",
		path: `/${projectionId}.cs`,
		query: query.toString(),
	});
}

function parseInlineCSharpProjectionUri(uri: vscode.Uri): ProjectionUriParsed | undefined {
	const query = new URLSearchParams(uri.query || "");
	const sourceUri = decodeQueryValue(query.get("sourceUri") || "");
	const versionValue = Number.parseInt(query.get("version") || "0", 10);
	const projectionId = decodeQueryValue(query.get("id") || "");
	if (!sourceUri || !projectionId || !Number.isFinite(versionValue)) {
		return undefined;
	}
	return {
		sourceUri,
		version: versionValue,
		projectionId,
		cacheKey: createInlineCSharpProjectionCacheKey(sourceUri, versionValue),
	};
}

function updateInlineCSharpProjectionCache(cacheEntry: InlineCSharpProjectionCacheEntry): void {
	inlineCSharpProjectionCache.set(cacheEntry.cacheKey, cacheEntry);
	for (const projection of cacheEntry.projections) {
		inlineCSharpProjectionUriCache.set(projection.uri.toString(), {
			cacheKey: cacheEntry.cacheKey,
			sourceUri: cacheEntry.sourceUri,
			version: cacheEntry.version,
			sourceText: cacheEntry.sourceText,
			projection,
		});
		if (inlineCSharpProjectionChangeEmitter) {
			inlineCSharpProjectionChangeEmitter.fire(projection.uri);
		}
	}
}

async function fetchInlineCSharpProjections(
	document: vscode.TextDocument,
	token?: vscode.CancellationToken,
): Promise<InlineCSharpProjectionCacheEntry | undefined> {
	if (!documentMayContainInlineCSharp(document)) {
		return undefined;
	}
	const activeClient = await tryEnsureClientStarted();
	if (!activeClient) {
		return undefined;
	}
	const sourceUri = document.uri.toString();
	const version = document.version ?? 0;
	const cacheKey = createInlineCSharpProjectionCacheKey(sourceUri, version);
	const cached = inlineCSharpProjectionCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const inflight = inlineCSharpProjectionFetches.get(cacheKey);
	if (inflight) {
		return inflight;
	}
	const fetchPromise = (async () => {
		const response = await activeClient.sendRequest<InlineCSharpProjectionResponse[]>(
			"axsg/inlineCSharpProjections",
			{
				textDocument: { uri: sourceUri },
				version,
				documentText: document.getText(),
			},
			token,
		);
		const responseItems = Array.isArray(response) ? response : [];
		const projections: InlineCSharpProjection[] = responseItems
			.filter(
				(item) =>
					item &&
					typeof item.id === "string" &&
					item.xamlRange &&
					item.projectedCodeRange &&
					typeof item.projectedText === "string",
			)
			.map((item) => ({
				id: item.id,
				kind: typeof item.kind === "string" ? item.kind : "expression",
				sourceUri,
				version,
				xamlRange: toVsCodeRange(item.xamlRange),
				projectedCodeRange: toVsCodeRange(item.projectedCodeRange),
				projectedText: item.projectedText,
				uri: buildInlineCSharpProjectionUri(sourceUri, version, item.id),
			}));
		const entry: InlineCSharpProjectionCacheEntry = {
			cacheKey,
			sourceUri,
			version,
			sourceText: document.getText(),
			projections,
			projectionMap: new Map(projections.map((p) => [p.id, p])),
		};
		updateInlineCSharpProjectionCache(entry);
		return entry;
	})();
	inlineCSharpProjectionFetches.set(cacheKey, fetchPromise);
	try {
		return await fetchPromise;
	} finally {
		inlineCSharpProjectionFetches.delete(cacheKey);
	}
}

async function resolveInlineCSharpProjectionFromUri(
	uri: vscode.Uri,
	token?: vscode.CancellationToken,
): Promise<InlineCSharpProjectionUriCacheEntry | undefined> {
	const cached = inlineCSharpProjectionUriCache.get(uri.toString());
	if (cached) {
		return cached;
	}
	const parsed = parseInlineCSharpProjectionUri(uri);
	if (!parsed) {
		return undefined;
	}
	const exactCacheEntry = inlineCSharpProjectionCache.get(parsed.cacheKey);
	if (exactCacheEntry) {
		const exactProjection = exactCacheEntry.projectionMap.get(parsed.projectionId);
		if (exactProjection) {
			return {
				cacheKey: exactCacheEntry.cacheKey,
				sourceUri: exactCacheEntry.sourceUri,
				version: exactCacheEntry.version,
				sourceText: exactCacheEntry.sourceText,
				projection: exactProjection,
			};
		}
	}
	const sourceDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(parsed.sourceUri));
	if ((sourceDocument.version ?? 0) !== parsed.version) {
		return undefined;
	}
	const cacheEntry = await fetchInlineCSharpProjections(sourceDocument, token);
	if (!cacheEntry) {
		return undefined;
	}
	const projection = cacheEntry.projectionMap.get(parsed.projectionId);
	if (!projection) {
		return undefined;
	}
	return {
		cacheKey: cacheEntry.cacheKey,
		sourceUri: cacheEntry.sourceUri,
		version: cacheEntry.version,
		sourceText: cacheEntry.sourceText,
		projection,
	};
}

async function openInlineCSharpProjectionDocument(projectionUri: vscode.Uri): Promise<vscode.TextDocument> {
	let document = await vscode.workspace.openTextDocument(projectionUri);
	if (document.languageId !== "csharp") {
		document = await vscode.languages.setTextDocumentLanguage(document, "csharp");
	}
	return document;
}

async function tryGetInlineCSharpProjectionAtPosition(
	document: vscode.TextDocument,
	position: vscode.Position,
	token?: vscode.CancellationToken,
): Promise<InlineCSharpProjectionAtPosition | undefined> {
	if (!isXamlDocument(document)) {
		return undefined;
	}
	const cacheEntry = await fetchInlineCSharpProjections(document, token);
	if (!cacheEntry || !Array.isArray(cacheEntry.projections) || cacheEntry.projections.length === 0) {
		return undefined;
	}
	for (const projection of cacheEntry.projections) {
		if (!containsPosition(projection.xamlRange, position)) {
			continue;
		}
		const projectedPosition = mapXamlPositionToProjectedPosition(cacheEntry.sourceText, projection, position);
		if (!projectedPosition) {
			continue;
		}
		const projectedDocument = await openInlineCSharpProjectionDocument(projection.uri);
		return { cacheEntry, projection, projectedPosition, projectedDocument };
	}
	return undefined;
}

// ── inline C# request helpers ────────────────────────────────────────

async function tryExecuteCommand<T>(command: string, ...args: any[]): Promise<T | undefined> {
	try {
		return await vscode.commands.executeCommand<T>(command, ...args);
	} catch {
		return undefined;
	}
}

async function requestInlineCSharpCompletion(
	document: vscode.TextDocument,
	position: vscode.Position,
	completionContext: vscode.CompletionContext | undefined,
	token?: vscode.CancellationToken,
): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
	const projectionInfo = await tryGetInlineCSharpProjectionAtPosition(document, position, token);
	if (!projectionInfo) {
		return undefined;
	}
	const result = await tryExecuteCommand<vscode.CompletionList>(
		"vscode.executeCompletionItemProvider",
		projectionInfo.projectedDocument.uri,
		projectionInfo.projectedPosition,
		completionContext && typeof completionContext.triggerCharacter === "string"
			? completionContext.triggerCharacter
			: undefined,
	);
	if (!result) {
		return undefined;
	}
	if (Array.isArray(result)) {
		const items = (result as vscode.CompletionItem[])
			.map((item) =>
				mapProjectedCompletionItem(projectionInfo.cacheEntry.sourceText, projectionInfo.projection, item),
			)
			.filter(Boolean) as vscode.CompletionItem[];
		return items.length > 0 ? items : undefined;
	}
	if (Array.isArray(result.items)) {
		const items = result.items
			.map((item) =>
				mapProjectedCompletionItem(projectionInfo.cacheEntry.sourceText, projectionInfo.projection, item),
			)
			.filter(Boolean) as vscode.CompletionItem[];
		if (items.length === 0) {
			return undefined;
		}
		return new vscode.CompletionList(items, result.isIncomplete);
	}
	return undefined;
}

async function requestInlineCSharpHover(
	document: vscode.TextDocument,
	position: vscode.Position,
	token?: vscode.CancellationToken,
): Promise<vscode.Hover | undefined> {
	const projectionInfo = await tryGetInlineCSharpProjectionAtPosition(document, position, token);
	if (!projectionInfo) {
		return undefined;
	}
	const hovers = await tryExecuteCommand<vscode.Hover[]>(
		"vscode.executeHoverProvider",
		projectionInfo.projectedDocument.uri,
		projectionInfo.projectedPosition,
	);
	if (!Array.isArray(hovers) || hovers.length === 0) {
		return undefined;
	}
	for (const hover of hovers) {
		const mappedHover = mapProjectedHover(projectionInfo.cacheEntry.sourceText, projectionInfo.projection, hover);
		if (mappedHover) {
			return mappedHover;
		}
	}
	return undefined;
}

async function requestInlineCSharpLocations(
	command: string,
	document: vscode.TextDocument,
	position: vscode.Position,
	token: vscode.CancellationToken | undefined,
	includeDeclaration?: boolean,
): Promise<vscode.Location[]> {
	const projectionInfo = await tryGetInlineCSharpProjectionAtPosition(document, position, token);
	if (!projectionInfo) {
		return [];
	}
	const locations = await tryExecuteCommand<any>(
		command,
		projectionInfo.projectedDocument.uri,
		projectionInfo.projectedPosition,
		includeDeclaration,
	);
	return dedupeLocations(
		normalizeLocationResults(locations)
			.map(mapProjectedResultLocation)
			.filter((location): location is vscode.Location => location instanceof vscode.Location),
	);
}

// ── cross-language requests ──────────────────────────────────────────

async function requestCrossLanguageLocations(
	method: string,
	document: vscode.TextDocument,
	position: vscode.Position,
	token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
	const activeClient = await tryEnsureClientStarted();
	if (!activeClient) {
		return [];
	}
	const response = await activeClient.sendRequest<ProtocolLocation[]>(
		method,
		{
			textDocument: { uri: document.uri.toString() },
			position: toProtocolPosition(position),
			documentText: document.getText(),
		},
		token,
	);
	if (!Array.isArray(response)) {
		return [];
	}
	return response
		.map(toVsCodeLocation)
		.filter((location): location is vscode.Location => location instanceof vscode.Location);
}

// ── workspace edit helpers ───────────────────────────────────────────

function appendProtocolWorkspaceEdit(
	workspaceEdit: vscode.WorkspaceEdit,
	edit: ProtocolWorkspaceEdit | undefined,
): number {
	if (!workspaceEdit || !edit || !edit.changes || typeof edit.changes !== "object") {
		return 0;
	}
	let count = 0;
	for (const [uri, edits] of Object.entries(edit.changes)) {
		if (!Array.isArray(edits)) {
			continue;
		}
		const documentUri = vscode.Uri.parse(uri);
		for (const editItem of edits) {
			if (!editItem || !editItem.range) {
				continue;
			}
			workspaceEdit.replace(
				documentUri,
				toVsCodeRange(editItem.range),
				typeof editItem.newText === "string" ? editItem.newText : "",
			);
			count++;
		}
	}
	return count;
}

async function applyProtocolWorkspaceEdit(edit: ProtocolWorkspaceEdit | undefined): Promise<boolean> {
	if (!edit || !edit.changes || typeof edit.changes !== "object") {
		return false;
	}
	const workspaceEdit = new vscode.WorkspaceEdit();
	appendProtocolWorkspaceEdit(workspaceEdit, edit);
	return vscode.workspace.applyEdit(workspaceEdit);
}

// ── rename workflow ──────────────────────────────────────────────────

function tryParseCommandPositionArgument(value: any): vscode.Position | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const candidate = value.position;
	if (!candidate || typeof candidate !== "object") {
		return undefined;
	}
	if (!Number.isInteger(candidate.line) || !Number.isInteger(candidate.character)) {
		return undefined;
	}
	return new vscode.Position(candidate.line, candidate.character);
}

async function resolveEditorForRenameArgument(argument: any): Promise<vscode.TextEditor | undefined> {
	if (!argument || typeof argument !== "object" || typeof argument.uri !== "string" || argument.uri.length === 0) {
		return vscode.window.activeTextEditor;
	}
	const targetUri = vscode.Uri.parse(argument.uri);
	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor && activeEditor.document.uri.toString() === targetUri.toString()) {
		return activeEditor;
	}
	const visibleEditor = vscode.window.visibleTextEditors.find(
		(editor) => editor.document.uri.toString() === targetUri.toString(),
	);
	if (visibleEditor) {
		return visibleEditor;
	}
	const document = await vscode.workspace.openTextDocument(targetUri);
	return vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
}

async function executeNativeCSharpPrepareRename(
	document: vscode.TextDocument,
	position: vscode.Position,
): Promise<any> {
	suppressCSharpRenameProvider = true;
	try {
		return await vscode.commands.executeCommand("_executePrepareRename", document.uri, position);
	} finally {
		suppressCSharpRenameProvider = false;
	}
}

async function executeNativeCSharpRename(
	document: vscode.TextDocument,
	position: vscode.Position,
	newName: string,
): Promise<vscode.WorkspaceEdit | undefined> {
	suppressCSharpRenameProvider = true;
	try {
		return await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
			"_executeDocumentRenameProvider",
			document.uri,
			position,
			newName,
		);
	} finally {
		suppressCSharpRenameProvider = false;
	}
}

async function buildCombinedCSharpRenameEdit(
	document: vscode.TextDocument,
	position: vscode.Position,
	newName: string,
	token: vscode.CancellationToken | undefined,
	showWarnings: boolean,
): Promise<vscode.WorkspaceEdit | undefined> {
	let nativeRenameEdit: vscode.WorkspaceEdit | undefined;
	try {
		nativeRenameEdit = await executeNativeCSharpRename(document, position, newName);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (showWarnings) {
			void vscode.window.showWarningMessage(`AXSG could not compute the C# rename edit: ${message}`);
		}
		throw error;
	}
	if (!(nativeRenameEdit instanceof vscode.WorkspaceEdit)) {
		return undefined;
	}
	const activeClient = await tryEnsureClientStarted();
	if (!activeClient) {
		return nativeRenameEdit;
	}
	try {
		const xamlPropagationEdit = await activeClient.sendRequest<ProtocolWorkspaceEdit>(
			"axsg/csharp/renamePropagation",
			{
				textDocument: { uri: document.uri.toString() },
				position: toProtocolPosition(position),
				documentText: document.getText(),
				newName,
			},
			token,
		);
		appendProtocolWorkspaceEdit(nativeRenameEdit, xamlPropagationEdit);
	} catch (error) {
		if (showWarnings) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showWarningMessage(`AXSG could not compute XAML propagation edits: ${message}`);
		}
	}
	return nativeRenameEdit;
}

async function executeAxsgRename(editor: vscode.TextEditor, position: vscode.Position): Promise<void> {
	const activeClient = await tryEnsureClientStarted();
	if (!activeClient) {
		return;
	}
	const document = editor.document;
	const params = {
		textDocument: { uri: document.uri.toString() },
		position: toProtocolPosition(position),
		documentText: document.getText(),
	};
	const prepareResult = await activeClient.sendRequest<PrepareRenameResponse>("axsg/refactor/prepareRename", params);
	if (!prepareResult || !prepareResult.range) {
		void vscode.window.showInformationMessage("AXSG rename is not available at the current position.");
		return;
	}
	const newName = await vscode.window.showInputBox({
		title: "AXSG Rename Symbol Across C# and XAML",
		value: prepareResult.placeholder || "",
		prompt: "Enter the new symbol name.",
	});
	if (typeof newName !== "string" || newName.length === 0 || newName === prepareResult.placeholder) {
		return;
	}
	const renameResult = await activeClient.sendRequest<ProtocolWorkspaceEdit>("axsg/refactor/rename", {
		...params,
		newName,
	});
	const applied = await applyProtocolWorkspaceEdit(renameResult);
	if (!applied) {
		void vscode.window.showWarningMessage("AXSG could not apply the computed rename edits.");
	}
}

async function executeCSharpRename(editor: vscode.TextEditor, position: vscode.Position): Promise<void> {
	const document = editor.document;
	let prepareResult: any;
	try {
		prepareResult = await executeNativeCSharpPrepareRename(document, position);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showWarningMessage(`AXSG could not prepare the C# rename: ${message}`);
		return;
	}
	if (!prepareResult) {
		void vscode.window.showInformationMessage("Rename is not available at the current C# position.");
		return;
	}
	const placeholder =
		typeof prepareResult.placeholder === "string" ? prepareResult.placeholder : document.getText(prepareResult.range);
	const newName = await vscode.window.showInputBox({
		title: "AXSG Rename Symbol Across C# and XAML",
		value: placeholder,
		prompt: "Enter the new symbol name.",
	});
	if (typeof newName !== "string" || newName.length === 0 || newName === placeholder) {
		return;
	}
	const nativeRenameEdit = await buildCombinedCSharpRenameEdit(document, position, newName, undefined, true);
	if (!(nativeRenameEdit instanceof vscode.WorkspaceEdit)) {
		void vscode.window.showWarningMessage("AXSG could not retrieve the C# rename edit from VS Code.");
		return;
	}
	const applied = await vscode.workspace.applyEdit(nativeRenameEdit);
	if (!applied) {
		void vscode.window.showWarningMessage("AXSG could not apply the combined C# and XAML rename edits.");
	}
}

async function executeCrossLanguageRenameCommand(argument: any): Promise<void> {
	const activeClient = await tryEnsureClientStarted();
	if (!activeClient) {
		return;
	}
	const editor = await resolveEditorForRenameArgument(argument);
	if (!editor) {
		return;
	}
	const position = tryParseCommandPositionArgument(argument) ?? argument ?? editor.selection.active;
	const document = editor.document;
	if (isCSharpDocument(document)) {
		await executeCSharpRename(editor, position);
		return;
	}
	if (isXamlDocument(document)) {
		await executeAxsgRename(editor, position);
	}
}

// ── status bar ───────────────────────────────────────────────────────

function setStatusBarState(state: StatusBarState, details: ServerStartupDetails, errorMessage?: string): void {
	if (!statusBarItem) {
		return;
	}
	if (state === "starting") {
		statusBarItem.text = "$(sync~spin) AXSG";
	} else if (state === "running") {
		statusBarItem.text = "$(info) AXSG";
	} else if (state === "idle") {
		statusBarItem.text = "$(debug-disconnect) AXSG";
	} else {
		statusBarItem.text = "$(error) AXSG";
	}
	const argsText = details.args.length > 0 ? details.args.join(" ") : "<none>";
	const errorText = errorMessage ? `\nError: ${errorMessage}` : "";
	statusBarItem.tooltip = `AXSG Language Server\nState: ${state}\nMode: ${details.effectiveMode}\nCommand: ${details.command}\nArgs: ${argsText}\nWorkspace: ${details.workspaceRoot}${errorText}`;
}

// ── client lifecycle ─────────────────────────────────────────────────

function resolveWorkspaceRoot(): string {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return process.cwd();
	}
	return folders[0].uri.fsPath;
}

function createLanguageClient(context: vscode.ExtensionContext): lsp.LanguageClient | undefined {
	if (!startupDetails) {
		return undefined;
	}
	outputChannel = outputChannel ?? vscode.window.createOutputChannel("AXSG Language Server");
	const configuration = vscode.workspace.getConfiguration("axsg");

	const clientOptions: lsp.LanguageClientOptions = {
		documentSelector: [
			{ scheme: "file", language: "axaml" },
			//{ scheme: "file", language: "xaml" },
		],
		synchronize: {
			//fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{xaml,axaml}"),
			fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{axaml}"),
		},
		outputChannel,
		initializationOptions: {
			extensionPath: context.extensionPath,
			inlayHints: {
				bindingTypeHintsEnabled: configuration.get<boolean>("inlayHints.bindingTypeHints.enabled", true),
				typeDisplayStyle: configuration.get<string>("inlayHints.typeDisplayStyle", "short"),
			},
		},
		middleware: {
			provideCompletionItem: async (document, position, completionContext, token, next) => {
				const fallbackResult = await next(document, position, completionContext, token);
				if (hasCompletionItems(fallbackResult)) {
					return fallbackResult;
				}
				const inlineResult = await requestInlineCSharpCompletion(document, position, completionContext, token);
				return inlineResult ?? fallbackResult;
			},
			provideHover: async (document, position, token, next) => {
				const fallbackHover = await next(document, position, token);
				if (fallbackHover) {
					return fallbackHover;
				}
				const inlineHover = await requestInlineCSharpHover(document, position, token);
				return inlineHover ?? fallbackHover;
			},
			provideDefinition: async (document, position, token, next) => {
				const fallbackLocations = dedupeLocations(
					normalizeLocationResults(await next(document, position, token))
						.map(mapProjectedResultLocation)
						.filter(
							(location): location is vscode.Location => location instanceof vscode.Location,
						),
				);
				if (fallbackLocations.length > 0) {
					return fallbackLocations;
				}
				const inlineLocations = await requestInlineCSharpLocations(
					"vscode.executeDefinitionProvider",
					document,
					position,
					token,
					undefined,
				);
				return inlineLocations.length > 0 ? inlineLocations : undefined;
			},
			provideDeclaration: async (document, position, token, next) => {
				const fallbackLocations = dedupeLocations(
					normalizeLocationResults(await next(document, position, token))
						.map(mapProjectedResultLocation)
						.filter(
							(location): location is vscode.Location => location instanceof vscode.Location,
						),
				);
				if (fallbackLocations.length > 0) {
					return fallbackLocations;
				}
				const inlineLocations = await requestInlineCSharpLocations(
					"vscode.executeDeclarationProvider",
					document,
					position,
					token,
					undefined,
				);
				return inlineLocations.length > 0 ? inlineLocations : undefined;
			},
			provideReferences: async (document, position, referenceContext, token, next) => {
				const fallbackLocations = dedupeLocations(
					normalizeLocationResults(await next(document, position, referenceContext, token))
						.map(mapProjectedResultLocation)
						.filter(
							(location): location is vscode.Location => location instanceof vscode.Location,
						),
				);
				if (fallbackLocations.length > 0) {
					return fallbackLocations;
				}
				const inlineLocations = await requestInlineCSharpLocations(
					"vscode.executeReferenceProvider",
					document,
					position,
					token,
					referenceContext && referenceContext.includeDeclaration === true,
				);
				return inlineLocations.length > 0 ? inlineLocations : undefined;
			},
		},
	};

	const trace = configuration.get<string>("languageServer.trace", "off");
	const clientInstance = new lsp.LanguageClient(
		"axsgLanguageServer",
		"AXSG Language Server",
		startupDetails as any as lsp.ServerOptions,
		clientOptions,
	);
	if (trace === "messages" || trace === "verbose") {
		clientInstance.setTrace(
			trace === "verbose" ? lsp.Trace.Verbose : lsp.Trace.Messages,
		);
	}
	return clientInstance;
}

async function ensureClientStarted(
	context: vscode.ExtensionContext,
): Promise<lsp.LanguageClient | undefined> {
	if (clientStartPromise) {
		return clientStartPromise;
	}
	if (!client) {
		client = createLanguageClient(context);
	}
	if (!client || !startupDetails) {
		return undefined;
	}
	setStatusBarState("starting", startupDetails);
	const startingClient = client;
	clientStartPromise = (async () => {
		try {
			await startingClient.start();
			setStatusBarState("running", startupDetails!);
			return startingClient;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setStatusBarState("error", startupDetails!, message);
			if (client === startingClient) {
				client = undefined;
			}
			clientStartPromise = undefined;
			throw error;
		}
	})();
	return clientStartPromise;
}

async function tryEnsureClientStarted(): Promise<lsp.LanguageClient | undefined> {
	try {
		return await ensureClientStarted(currentContext!);
	} catch {
		return undefined;
	}
}

// We store the extension context at module level so tryEnsureClientStarted
// can use it without requiring it as a parameter in every helper.
let currentContext: vscode.ExtensionContext | undefined;

// ── public API ───────────────────────────────────────────────────────

/**
 * Creates the full AXSG language service: language client with rich
 * middleware, virtual document providers, cross-language providers,
 * rename command, and status bar item.
 *
 * The client is NOT started automatically -- call `ensureStarted()` or
 * it will lazily start when a XAML/AXAML document is opened.
 */
export async function createAxsgLanguageService(
	context: vscode.ExtensionContext,
): Promise<AxsgLanguageService> {
	currentContext = context;
	const disposables: vscode.Disposable[] = [];

	// ── resolve server options ────────────────────────────────────
	const dotnetPath = await getDotnetRuntimePath();
	const serverPath = getLanguageServerPath();
	const workspaceRoot = resolveWorkspaceRoot();

	startupDetails = {
		effectiveMode: "bundled",
		workspaceRoot,
		command: dotnetPath,
		args: [serverPath, "--workspace", workspaceRoot],
	};

	// The server options object for vscode-languageclient
	const serverOptions: lsp.ServerOptions = {
		command: dotnetPath,
		args: [serverPath, "--workspace", workspaceRoot],
		transport: lsp.TransportKind.stdio,
		options: {
			cwd: workspaceRoot,
			env: process.env as Record<string, string>,
		},
	};
	// Store serverOptions into startupDetails for the client factory
	// We use a cast because ServerOptions is a union type
	(startupDetails as any).command = serverOptions.command;
	(startupDetails as any).args = (serverOptions as lsp.Executable).args ?? [];

	// Overwrite the module-level startupDetails with the actual server options
	// that the client factory will consume
	Object.assign(startupDetails, serverOptions);

	// ── event emitters ────────────────────────────────────────────
	metadataChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	disposables.push(metadataChangeEmitter);
	sourceLinkChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	disposables.push(sourceLinkChangeEmitter);
	inlineCSharpProjectionChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
	disposables.push(inlineCSharpProjectionChangeEmitter);

	// ── virtual document providers ────────────────────────────────
	disposables.push(
		vscode.workspace.registerTextDocumentContentProvider(AXSG_METADATA_SCHEME, {
			onDidChange: metadataChangeEmitter.event,
			provideTextDocumentContent(uri: vscode.Uri): string {
				return renderMetadataDocument(uri);
			},
		}),
	);
	disposables.push(
		vscode.workspace.registerTextDocumentContentProvider(AXSG_SOURCELINK_SCHEME, {
			onDidChange: sourceLinkChangeEmitter.event,
			provideTextDocumentContent(uri: vscode.Uri): string {
				return renderSourceLinkDocument(uri);
			},
		}),
	);
	disposables.push(
		vscode.workspace.registerTextDocumentContentProvider(AXSG_INLINE_CSHARP_SCHEME, {
			onDidChange: inlineCSharpProjectionChangeEmitter.event,
			async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
				const projectionInfo = await resolveInlineCSharpProjectionFromUri(uri);
				if (!projectionInfo) {
					const query = new URLSearchParams(uri.query || "");
					const sourceUri = decodeQueryValue(query.get("sourceUri") || "");
					return padVirtualLoadingDocument(
						`// AXSG inline C# projection\n// Loading projected C# for ${sourceUri || "<unknown source>"}...\n`,
					);
				}
				return projectionInfo.projection.projectedText;
			},
		}),
	);

	// ── commands ──────────────────────────────────────────────────
	disposables.push(
		vscode.commands.registerCommand("axsg.refactor.renameSymbol", async (argument: any) => {
			await executeCrossLanguageRenameCommand(argument);
		}),
	);

	disposables.push(
		vscode.commands.registerCommand("axsg.languageServer.showInfo", async () => {
			const info = `AXSG Language Server (${startupDetails?.effectiveMode ?? "unknown"})`;
			const selection = await vscode.window.showInformationMessage(info, "Open Output");
			if (selection === "Open Output" && outputChannel) {
				outputChannel.show(true);
			}
		}),
	);

	// ── cross-language providers for C# files ─────────────────────
	const csharpSelector: vscode.DocumentSelector = [{ scheme: "file", language: "csharp" }];

	disposables.push(
		vscode.languages.registerCodeActionsProvider(
			csharpSelector,
			{
				provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
					const position = range.start;
					const action = new vscode.CodeAction(
						"AXSG: Rename Symbol Across C# and XAML",
						AXSG_REFACTOR_RENAME_KIND,
					);
					action.isPreferred = true;
					action.command = {
						command: "axsg.refactor.renameSymbol",
						title: "AXSG: Rename Symbol Across C# and XAML",
						arguments: [position],
					};
					return [action];
				},
			},
			{ providedCodeActionKinds: [AXSG_REFACTOR_RENAME_KIND] },
		),
	);

	disposables.push(
		vscode.languages.registerReferenceProvider(csharpSelector, {
			async provideReferences(
				document: vscode.TextDocument,
				position: vscode.Position,
				_context: vscode.ReferenceContext,
				token: vscode.CancellationToken,
			): Promise<vscode.Location[]> {
				return requestCrossLanguageLocations("axsg/csharp/references", document, position, token);
			},
		}),
	);

	disposables.push(
		vscode.languages.registerDefinitionProvider(csharpSelector, {
			async provideDefinition(
				document: vscode.TextDocument,
				position: vscode.Position,
				token: vscode.CancellationToken,
			): Promise<vscode.Location[]> {
				return requestCrossLanguageLocations("axsg/csharp/declarations", document, position, token);
			},
		}),
	);

	disposables.push(
		vscode.languages.registerDeclarationProvider(csharpSelector, {
			async provideDeclaration(
				document: vscode.TextDocument,
				position: vscode.Position,
				token: vscode.CancellationToken,
			): Promise<vscode.Location[]> {
				return requestCrossLanguageLocations("axsg/csharp/declarations", document, position, token);
			},
		}),
	);

	disposables.push(
		vscode.languages.registerRenameProvider(csharpSelector, {
			async prepareRename(
				document: vscode.TextDocument,
				position: vscode.Position,
			): Promise<any> {
				if (suppressCSharpRenameProvider) {
					return undefined;
				}
				return executeNativeCSharpPrepareRename(document, position);
			},
			async provideRenameEdits(
				document: vscode.TextDocument,
				position: vscode.Position,
				newName: string,
				token: vscode.CancellationToken,
			): Promise<vscode.WorkspaceEdit | undefined> {
				if (suppressCSharpRenameProvider) {
					return undefined;
				}
				return buildCombinedCSharpRenameEdit(document, position, newName, token, false);
			},
		}),
	);

	// ── document open listener ────────────────────────────────────
	disposables.push(
		vscode.workspace.onDidOpenTextDocument(async (document) => {
			if (isXamlDocument(document)) {
				void tryEnsureClientStarted();
			}
			if (
				document.uri.scheme !== AXSG_METADATA_SCHEME &&
				document.uri.scheme !== AXSG_SOURCELINK_SCHEME &&
				document.uri.scheme !== AXSG_INLINE_CSHARP_SCHEME
			) {
				return;
			}
			if (document.languageId === "csharp") {
				return;
			}
			try {
				await vscode.languages.setTextDocumentLanguage(document, "csharp");
			} catch {
				// Ignore language switch failures for virtual metadata docs.
			}
		}),
	);

	// ── status bar ────────────────────────────────────────────────
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 110);
	statusBarItem.name = "AXSG Language Server";
	statusBarItem.command = "axsg.languageServer.showInfo";
	disposables.push(statusBarItem);
	statusBarItem.show();
	setStatusBarState("idle", startupDetails);

	// ── set context for keybinding when clauses ───────────────────
	await vscode.commands.executeCommand("setContext", "axsg.active", true);

	// ── build return object ───────────────────────────────────────
	const service: AxsgLanguageService = {
		get client() {
			return client;
		},
		disposables,
		ensureStarted: () => ensureClientStarted(context),
		stop: async () => {
			await vscode.commands.executeCommand("setContext", "axsg.active", false);
			if (client) {
				await client.stop();
				client = undefined;
			}
			clientStartPromise = undefined;
			// Clear caches
			metadataDocumentCache.clear();
			metadataUriSubscriptions.clear();
			sourceLinkDocumentCache.clear();
			sourceLinkUriSubscriptions.clear();
			inlineCSharpProjectionCache.clear();
			inlineCSharpProjectionFetches.clear();
			inlineCSharpProjectionUriCache.clear();
			inlineCSharpPresenceCache.clear();
			// Dispose all registered providers/commands/status bar
			for (const d of disposables) {
				d.dispose();
			}
			disposables.length = 0;
			statusBarItem = undefined;
			outputChannel = undefined;
			startupDetails = undefined;
			currentContext = undefined;
		},
	};

	logger.info("[AXSG] Language service created");
	logger.info(`[AXSG] dotnet: ${dotnetPath}`);
	logger.info(`[AXSG] server DLL: ${serverPath}`);
	logger.info(`[AXSG] workspace: ${workspaceRoot}`);

	return service;
}
