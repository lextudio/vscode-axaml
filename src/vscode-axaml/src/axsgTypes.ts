import * as vscode from "vscode";

export interface CacheEntry {
	state: "loading" | "ready" | "error";
	text: string;
}

export interface InlineCSharpProjection {
	id: string;
	kind: string;
	sourceUri: string;
	version: number;
	xamlRange: vscode.Range;
	projectedCodeRange: vscode.Range;
	projectedText: string;
	uri: vscode.Uri;
}

export interface InlineCSharpProjectionCacheEntry {
	cacheKey: string;
	sourceUri: string;
	version: number;
	sourceText: string;
	projections: InlineCSharpProjection[];
	projectionMap: Map<string, InlineCSharpProjection>;
}

export interface InlineCSharpProjectionUriCacheEntry {
	cacheKey: string;
	sourceUri: string;
	version: number;
	sourceText: string;
	projection: InlineCSharpProjection;
}

export interface InlineCSharpProjectionAtPosition {
	cacheEntry: InlineCSharpProjectionCacheEntry;
	projection: InlineCSharpProjection;
	projectedPosition: vscode.Position;
	projectedDocument: vscode.TextDocument;
}

export interface ProjectionUriParsed {
	sourceUri: string;
	version: number;
	projectionId: string;
	cacheKey: string;
}

export interface ServerStartupDetails {
	effectiveMode: string;
	workspaceRoot: string;
	command: string;
	args: string[];
}

export type StatusBarState = "idle" | "starting" | "running" | "error";

export interface ProtocolWorkspaceEdit {
	changes?: Record<string, ProtocolTextEdit[]>;
}

export interface ProtocolTextEdit {
	range: ProtocolRange;
	newText: string;
}

export interface ProtocolRange {
	start: { line: number; character: number };
	end: { line: number; character: number };
}

export interface ProtocolLocation {
	uri: string;
	range: ProtocolRange;
}

export interface MetadataDocumentResponse {
	text: string;
}

export interface PrepareRenameResponse {
	range: ProtocolRange;
	placeholder?: string;
}

export interface InlineCSharpProjectionResponse {
	id: string;
	kind?: string;
	xamlRange: ProtocolRange;
	projectedCodeRange: ProtocolRange;
	projectedText: string;
}

/**
 * Returned by createAxsgLanguageService. Callers use this to manage
 * the AXSG client lifecycle.
 */
export interface AxsgLanguageService {
	/** The underlying LanguageClient (undefined until first start). */
	client: import("vscode-languageclient/node").LanguageClient | undefined;
	/** Disposables that must be disposed when switching away from AXSG. */
	disposables: vscode.Disposable[];
	/** Lazily starts the client if not already running. */
	ensureStarted: () => Promise<import("vscode-languageclient/node").LanguageClient | undefined>;
	/** Stops the client and cleans up resources. */
	stop: () => Promise<void>;
}
