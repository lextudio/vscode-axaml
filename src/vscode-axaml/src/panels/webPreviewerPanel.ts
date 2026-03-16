import * as vscode from "vscode";
import path = require("path");
import { logger } from "../util/utilities";
import { PreviewProcessManager } from "../previewProcessManager";
import { PreviewServer } from "../services/previewServer";
import { Messages } from "../services/messageParser";

export class WebPreviewerPanel {
	public static currentPanel: WebPreviewerPanel | undefined;

	public static readonly viewType = "webPreviewer";

	private readonly _panel: vscode.WebviewPanel;
	private readonly _fileUrl: vscode.Uri;
	private _isLoading: boolean = false;
	private _isError: boolean = false;
	private readonly _mode: "html" | "tcp";
	/** Device pixel ratio reported by the webview (default 1 until the init message arrives). */
	private _devicePixelRatio = 1.0;

	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(
		url: string,
		fileUri: vscode.Uri,
		extensionUri: vscode.Uri,
		targetPath: string,
		processManager?: PreviewProcessManager,
		previewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
		mode: "html" | "tcp" = "html"
	) {
		const column =
			previewColumn || vscode.window.activeTextEditor?.viewColumn;

		// If we already have a panel, show it.
		if (WebPreviewerPanel.currentPanel) {
			WebPreviewerPanel.currentPanel._panel.reveal(column);
			WebPreviewerPanel.currentPanel._update(url);
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			WebPreviewerPanel.viewType,
			"Previewer",
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
			}
		);
		WebPreviewerPanel.currentPanel = new WebPreviewerPanel(
			panel,
			url,
			fileUri,
			targetPath,
			processManager,
			mode
		);

		this.updateTitle(fileUri);
		WebPreviewerPanel.currentPanel._panel.iconPath = {
			dark: vscode.Uri.joinPath(
				extensionUri,
				"media",
				"preview-dark.svg"
			),
			light: vscode.Uri.joinPath(
				extensionUri,
				"media",
				"preview-light.svg"
			),
		};
	}

	public static updateTitle(file: vscode.Uri) {
		const currentPanel = WebPreviewerPanel.currentPanel;
		if (currentPanel) {
			currentPanel._panel.title = `Preview ${path.basename(file.fsPath)}`;
		}
	}

	private constructor(
		panel: vscode.WebviewPanel,
		url: string,
		fileUrl: vscode.Uri,
		targetPath: string,
		private readonly _processManager?: PreviewProcessManager,
		mode: "html" | "tcp" = "html"
	) {
		this._panel = panel;
		this._fileUrl = fileUrl;
		this._mode = mode;

		const server = PreviewServer.getInstanceByAssemblyName(targetPath)!;

		if (this._mode === "tcp") {
			this._setupTcpMode(server);
		} else {
			this._setupHtmlMode(url, server);
		}

		// Listen for when the panel is disposed
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
	}

	private _setupHtmlMode(url: string, server: PreviewServer) {
		if (!server?.isReady) {
			this._isLoading = true;
			this._panel.webview.html = this._getLoadingHtml();

			const timeout = setTimeout(() => {
				if (this._isLoading) {
					this._isLoading = false;
					this._isError = true;
					this._panel.webview.html = this._getErrorHtml(
						new Error("Previewer did not become ready within 30 seconds.")
					);
				}
			}, 30_000);

			server.onReady.subscribe(() => {
				clearTimeout(timeout);
				this._isLoading = false;
				this._update(url);
			});
			server.onError.subscribe((_, error) => {
				clearTimeout(timeout);
				this._isLoading = false;
				this._isError = true;
				this._panel.webview.html = this._getErrorHtml(error);
			});
		} else {
			this._update(url);
		}
	}

	private _setupTcpMode(server: PreviewServer) {
		// Show loading state until first frame arrives.
		this._isLoading = true;
		this._panel.webview.html = this._getLoadingHtml();

		const timeout = setTimeout(() => {
			if (this._isLoading) {
				this._isLoading = false;
				this._isError = true;
				this._panel.webview.html = this._getErrorHtml(
					new Error("Previewer did not send a frame within 30 seconds.")
				);
			}
		}, 30_000);

		// Switch to canvas on first frame, then forward subsequent frames.
		let canvasReady = false;
		const frameSub = server.onFrame.subscribe((_, frame) => {
			if (this._isError) { return; }
			if (!canvasReady) {
				clearTimeout(timeout);
				this._isLoading = false;
				canvasReady = true;
				this._panel.webview.html = this._getCanvasHtml();
			}
			const rgba = Messages.toRgba(frame);
			this._panel.webview.postMessage({ type: "frame", width: frame.width, height: frame.height, rgba });
		});
		this._disposables.push({ dispose: () => frameSub() });

		// Surface crashes / errors in the panel.
		server.onError.subscribe((_, error) => {
			clearTimeout(timeout);
			this._isLoading = false;
			this._isError = true;
			this._panel.webview.html = this._getErrorHtml(error);
		});

		// Handle messages from the webview.
		const msgSub = this._panel.webview.onDidReceiveMessage((msg) => {
			if (msg.type === "init" && typeof msg.devicePixelRatio === "number") {
				this._devicePixelRatio = msg.devicePixelRatio;
				// Send native-DPI render info so the first frame is already sharp.
				const dpi = 96 * this._devicePixelRatio;
				server.sendClientRenderInfo(dpi, dpi);
			} else if (msg.type === "setScale" && typeof msg.scale === "number") {
				// DPI = native DPI × user zoom, so 100 % slider = actual size on screen.
				const dpi = 96 * this._devicePixelRatio * msg.scale;
				server.sendClientRenderInfo(dpi, dpi);
			}
		});
		this._disposables.push(msgSub);
	}

	/**
	 * Cleans up and disposes of webview resources when the webview panel is closed.
	 */
	public dispose() {
		WebPreviewerPanel.currentPanel = undefined;
		logger.info("Previewer panel disposed");

		// Dispose of the current webview panel
		this._panel.dispose();

		this._processManager?.killPreviewProcess();
		// Dispose of all disposables (i.e. commands) for the current webview panel
		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}

	private _update(url: string) {
		if (this._isError) {
			return;
		}
		if (this._mode === "tcp") {
			// Canvas HTML is already set in constructor; nothing to update on XAML switch.
			return;
		}
		this._panel.webview.html = this._getHtmlForWebview(url);
	}

	// ---------------------------------------------------------------------------
	// HTML (iframe) mode
	// ---------------------------------------------------------------------------

	private _getHtmlForWebview(url: string): string {
		const body = `
<div class="toolbar" role="toolbar" aria-label="Preview controls">
	<button id="refreshPreviewerBtn" class="btn icon" title="Restart Previewer" aria-label="Restart Previewer">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<path d="M20 12a8 8 0 1 1-2.343-5.657" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M20 4v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
	</button>
	<div class="divider" aria-hidden="true"></div>
	<button id="resetScaleBtn" class="btn icon" title="Reset scale to 100%" aria-label="Reset scale to 100%">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<text x="12" y="14" text-anchor="middle" dominant-baseline="middle" font-size="16" font-weight="700" fill="currentColor">1:1</text>
		</svg>
	</button>
	<label class="scale-group">
		<input type="range" id="scaleSlider" min="25" max="200" value="100" aria-label="Scale" />
		<span id="scaleLabel" class="scale-label">100%</span>
	</label>
</div>
<div id="scalable">
	<iframe src="${url}" id="preview" scrolling="no"></iframe>
</div>
<script>
	var scaleSlider = document.getElementById('scaleSlider');
	var scaleLabel = document.getElementById('scaleLabel');
	var resetScaleBtn = document.getElementById('resetScaleBtn');
	var refreshPreviewerBtn = document.getElementById('refreshPreviewerBtn');
	var scalable = document.getElementById('scalable');
	var previewFrame = document.getElementById('preview');
	var scale = 1.0;

	function setScale(newScale) {
		scale = newScale;
		if (scalable) {
			scalable.style.transform = 'scale(' + scale + ')';
		}
		if (scaleLabel) {
			scaleLabel.textContent = Math.round(scale * 100) + '%';
		}
		if (scaleSlider) {
			scaleSlider.value = String(Math.round(scale * 100));
		}
	}
	if (scaleSlider) {
		scaleSlider.addEventListener('input', function() {
			var newScale = Number(scaleSlider.value) / 100;
			setScale(newScale);
		});
	}
	if (resetScaleBtn) {
		resetScaleBtn.addEventListener('click', function() { setScale(1.0); });
	}
	if (refreshPreviewerBtn) {
		refreshPreviewerBtn.addEventListener('click', function() { if (previewFrame) { previewFrame.src = previewFrame.src; } });
	}
	setScale(scale);
</script>`;
		return this._getHtmlShell(body);
	}

	// ---------------------------------------------------------------------------
	// TCP (canvas) mode
	// ---------------------------------------------------------------------------

	private _getCanvasHtml(): string {
		const body = `
<div class="toolbar" role="toolbar" aria-label="Preview controls">
	<button id="resetScaleBtn" class="btn icon" title="Reset scale to 100%" aria-label="Reset scale to 100%">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<text x="12" y="14" text-anchor="middle" dominant-baseline="middle" font-size="16" font-weight="700" fill="currentColor">1:1</text>
		</svg>
	</button>
	<label class="scale-group">
		<input type="range" id="scaleSlider" min="25" max="200" value="100" aria-label="Scale" />
		<span id="scaleLabel" class="scale-label">100%</span>
	</label>
</div>
<div id="canvasContainer">
	<canvas id="preview"></canvas>
</div>
<script>
	var vscode = acquireVsCodeApi();
	var canvas = document.getElementById('preview');
	var ctx = canvas.getContext('2d');
	var scaleSlider = document.getElementById('scaleSlider');
	var scaleLabel = document.getElementById('scaleLabel');
	var resetScaleBtn = document.getElementById('resetScaleBtn');
	var scale = 1.0;
	var debounceTimer = null;
	var dpr = window.devicePixelRatio || 1;

	// Tell the extension our display DPI so it requests a correctly sized frame.
	vscode.postMessage({ type: 'init', devicePixelRatio: dpr });

	function applyScale(newScale) {
		scale = newScale;
		scaleLabel.textContent = Math.round(scale * 100) + '%';
		scaleSlider.value = String(Math.round(scale * 100));
		// Debounce rapid slider drags so we don't flood the previewer.
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(function() {
			vscode.postMessage({ type: 'setScale', scale: scale });
		}, 80);
	}

	scaleSlider.addEventListener('input', function() {
		applyScale(Number(scaleSlider.value) / 100);
	});
	resetScaleBtn.addEventListener('click', function() { applyScale(1.0); });

	window.addEventListener('message', function(event) {
		var msg = event.data;
		if (msg.type === 'frame') {
			// Paint the pixel buffer at its native resolution.
			canvas.width = msg.width;
			canvas.height = msg.height;
			// Size the CSS box so the content appears at the correct logical scale:
			// CSS px = physical px / devicePixelRatio, giving "actual size" at 100%.
			canvas.style.width  = (msg.width  / dpr) + 'px';
			canvas.style.height = (msg.height / dpr) + 'px';
			var imageData = new ImageData(new Uint8ClampedArray(msg.rgba), msg.width, msg.height);
			ctx.putImageData(imageData, 0, 0);
		}
	});
</script>`;
		return this._getHtmlShell(body);
	}

	// ---------------------------------------------------------------------------
	// Shared shell
	// ---------------------------------------------------------------------------

	private _getHtmlShell(bodyInner: string): string {
		return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Web Previewer</title>
	<style>
		html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: auto; }
		:root {
			--toolbar-height: 40px;
			--gap: 8px;
			--radius: 6px;
		}
		body {
			background-size: 15px 15px;
			background-image:
				linear-gradient(to right, var(--vscode-focusBorder) 0.1px, transparent 1px),
				linear-gradient(to bottom, var(--vscode-focusBorder) 0.1px, transparent 1px);
		}
		.toolbar {
			position: fixed;
			top: 0; left: 0; right: 0;
			height: var(--toolbar-height);
			display: flex;
			align-items: center;
			gap: var(--gap);
			padding: 0 10px;
			background: var(--vscode-tab-activeBackground);
			border-bottom: 1px solid var(--vscode-panelSectionHeader-border, rgba(255,255,255,0.16));
			box-shadow: 0 1px 3px rgba(0,0,0,0.2);
			box-sizing: border-box;
			z-index: 1;
		}
		.divider { width: 1px; height: 22px; background: var(--vscode-editorGroup-border); margin: 0 2px; }
		.btn {
			height: 28px;
			padding: 0 10px;
			border-radius: var(--radius);
			border: 1px solid var(--vscode-button-border, transparent);
			background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
			color: var(--vscode-button-foreground);
			font: inherit;
			line-height: 28px;
			cursor: pointer;
			transition: background 120ms ease, border-color 120ms ease, transform 60ms ease;
			display: inline-flex; align-items: center; justify-content: center;
		}
		.btn:hover { background: var(--vscode-button-hoverBackground); }
		.btn:active { transform: translateY(1px); }
		.btn.icon { width: 28px; padding: 0; }
		.btn svg { display: block; }
		.btn[disabled] { opacity: .5; cursor: not-allowed; }
		.btn:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
		.scale-group { display: inline-flex; align-items: center; gap: 8px; }
		.scale-group input[type="range"] { height: 2px; }
		.scale-label { min-width: 44px; text-align: right; color: var(--vscode-editor-foreground); opacity: 0.8; font-size: 12px; }
		/* HTML mode */
		#scalable { margin-top: var(--toolbar-height); transform-origin: top left; transform: scale(1); width: max-content; height: max-content; z-index: 0; }
		iframe { width: 7680px; height: 4320px; border: none; display: block; }
		/* TCP mode */
		#canvasContainer { margin-top: var(--toolbar-height); display: inline-block; }
		canvas { display: block; image-rendering: pixelated; }
		/* extras used by loading/error */
		.center { width: 100%; height: calc(100% - var(--toolbar-height)); display: flex; align-items: center; justify-content: center; }
		.spinner { width: 44px; height: 44px; border: 6px solid #eee; border-top: 6px solid var(--vscode-focusBorder, #0078d4); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 14px; }
		@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
		.message { color: var(--vscode-editor-foreground, #fff); font-size: 13px; text-align: center; font-family: sans-serif; }
		.card { background: color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent); border: 1px solid var(--vscode-editorWidget-border); padding: 12px 16px; border-radius: var(--radius); box-shadow: 0 2px 8px rgba(0,0,0,.2); max-width: 520px; }
		.card .title { font-weight: 600; margin-bottom: 6px; }
		.card .error-msg { font-family: monospace; font-size: 12px; background: rgba(255,0,0,.08); border: 1px solid rgba(255,0,0,.2); border-radius: 4px; padding: 6px 8px; margin: 6px 0; word-break: break-word; }
		.card .hint { font-size: 12px; opacity: 0.7; margin-top: 8px; }
	</style>
</head>
<body>
${bodyInner}
</body>
</html>`;
	}

	private _getLoadingHtml(): string {
		const body = `
	<div class="center">
		<div class="card">
			<div class="title">Preparing preview…</div>
			<div>Preview is starting. If this takes too long, close this panel and try again.</div>
			<div class="spinner"></div>
		</div>
	</div>`;
		return this._getHtmlShell(body);
	}

	private _getErrorHtml(error: Error): string {
		const body = `
	<div class="center">
		<div class="card">
			<div class="title">Preview failed</div>
			<div class="error-msg">${error.message}</div>
			<div class="hint">Close this panel, fix the issue, then run <strong>Show Preview</strong> again.</div>
		</div>
	</div>`;
		return this._getHtmlShell(body);
	}
}
