// The module 'vscode' contains the VS Code extensibility API

import * as vscode from "vscode";
import * as fs from "fs-extra";
import * as lsp from "vscode-languageclient/node";
import { createLanguageService } from "./client";
import { createAxsgLanguageService } from "./axsgClient";
import type { AxsgLanguageService } from "./axsgTypes";
import { registerAxamlCommands as registerAxamlCommands, processManager } from "./commands";
import { WebPreviewerPanel } from "./panels/webPreviewerPanel";
import { CommandManager } from "./commandManager";
import * as util from "./util/utilities";
import { logger } from "./util/utilities";
import {
	getLastDiscoveryMeta,
	buildSolutionModel,
	getSolutionDataFile,
	getSolutionModel,
	selectSolutionOnActivation,
	setSelectedSolutionSetting,
} from "./services/solutionParser";
import AppConstants from "./util/constants";

let languageClient: lsp.LanguageClient | null = null;
let axsgService: AxsgLanguageService | null = null;
let _conflictCheckTimer: NodeJS.Timeout | null = null;

// Language status items (module-level so we can hide/show on conflict)
let modelStatus: vscode.LanguageStatusItem | undefined;
let solutionStatus: vscode.LanguageStatusItem | undefined;
let axamlProjectStatusItem: vscode.LanguageStatusItem | undefined;
const axamlSelector: vscode.DocumentSelector = { language: "axaml", scheme: "file" };

function hideLanguageStatusItems() {
	if (modelStatus) { modelStatus.selector = []; }
	if (solutionStatus) { solutionStatus.selector = []; }
	if (axamlProjectStatusItem) { axamlProjectStatusItem.selector = []; }
}

function showLanguageStatusItems() {
	if (modelStatus) { modelStatus.selector = axamlSelector; }
	if (solutionStatus) { solutionStatus.selector = axamlSelector; }
	if (axamlProjectStatusItem) { axamlProjectStatusItem.selector = axamlSelector; }
}

function applyServerSpecificStatusItems(isAxsg: boolean) {
	// modelStatus (cache readiness) is only meaningful for the AXSG server
	if (modelStatus) {
		modelStatus.selector = isAxsg ? axamlSelector : [];
	}
}

function checkForConflictingExtensions(context?: vscode.ExtensionContext): boolean {
	const suppressKey = "axaml.conflictWarnSuppress";
	if (context && context.globalState.get<boolean>(suppressKey, false)) {
		// Ensure UI is not hidden if user suppressed warnings
		void vscode.commands.executeCommand("setContext", "axaml.conflictDetected", false);
		return false;
	}
	const installed = util.conflictingExtensions
		.map((id) => vscode.extensions.getExtension(id))
		.filter((ext) => !!ext) as vscode.Extension<any>[];
	if (installed.length) {
		const names = installed.map((e) => e.id).join(", ");
		void vscode.commands.executeCommand("setContext", "axaml.conflictDetected", true);
		void Promise.resolve(vscode.window
			.showWarningMessage(
				`Other AXAML extensions detected (${names}). They may conflict. It is recommended to uninstall them and keep only 'lextudio.vscode-axaml'.`,
				"Open Extensions",
				"Don't Show Again"
			))
			.then(async (choice) => {
				if (choice === "Open Extensions") {
					await vscode.commands.executeCommand(
						"workbench.extensions.search",
						"@installed avalonia"
					);
				} else if (choice === "Don't Show Again" && context) {
					await context.globalState.update(suppressKey, true);
				}
			})
			.catch(() => {
				/* ignore */
			});
		return true;
	}
	void vscode.commands.executeCommand("setContext", "axaml.conflictDetected", false);
	return false;
}

/**
 * @returns undefined when no workspace folders are open.
 */
export async function activate(context: vscode.ExtensionContext) {

	// Perform initial conflicting-extension check and register listener
	checkForConflictingExtensions(context);
	context.subscriptions.push(
		vscode.extensions.onDidChange(() => {
			if (_conflictCheckTimer) {
				clearTimeout(_conflictCheckTimer);
			}
			_conflictCheckTimer = setTimeout(async () => {
				const has = checkForConflictingExtensions(context);
				if (has) {
					try {
						// Stop language servers
						await stopActiveLanguageServer();
					} catch (e) {
						logger.error(`Failed stopping language server after conflict detected: ${e}`);
					}
					try {
						// Kill preview processes and close preview panel
						processManager.killPreviewProcess();
					} catch (e) {
						logger.error(`Failed killing preview processes after conflict detected: ${e}`);
					}
					try {
						WebPreviewerPanel.currentPanel?.dispose();
					} catch (e) {
						logger.error(`Failed closing preview panel after conflict detected: ${e}`);
					}
					hideLanguageStatusItems();
				} else {
					showLanguageStatusItems();
					if (!axsgService && !languageClient) {
						try {
							await startLanguageServer(context);
						} catch (e) {
							logger.error(`Failed starting language server after conflict cleared: ${e}`);
						}
					}
				}
			}, 500);
		})
	);

	// Recommend XAML Styler extension if not installed and user hasn't suppressed recommendation
	try {
		const stylerId = "dabbinavo.xamlstyler";
		const suppress = vscode.workspace
			.getConfiguration()
			.get<boolean>(
				"axaml.misc.suppressXamlStylerRecommendation",
				vscode.workspace
					.getConfiguration()
					.get<boolean>(
						"axaml.suppressXamlStylerRecommendation",
						false
					)
			);
		if (!suppress && !vscode.extensions.getExtension(stylerId)) {
			const choice = await vscode.window.showInformationMessage(
				"For formatting AXAML you can optionally install 'XAML Styler'. Would you like to view it?",
				"Show Extension",
				"Don't Show Again"
			);
			if (choice === "Show Extension") {
				await vscode.commands.executeCommand(
					"workbench.extensions.search",
					stylerId
				);
			} else if (choice === "Don't Show Again") {
				// Update both new and old keys for consistency
				await vscode.workspace
					.getConfiguration()
					.update(
						"axaml.misc.suppressXamlStylerRecommendation",
						true,
						vscode.ConfigurationTarget.Global
					);
				await vscode.workspace
					.getConfiguration()
					.update(
						"axaml.suppressXamlStylerRecommendation",
						true,
						vscode.ConfigurationTarget.Global
					);
			}
		}
	} catch (e) {
		logger.error(`Failed recommending XAML Styler: ${e}`);
	}

	// Track activation count and prompt for rating after threshold
	try {
		const ratingSuppressKey = "axaml.rateSuppress";
		const activationCountKey = "axaml.activationCount";
		const suppressed = context.globalState.get<boolean>(
			ratingSuppressKey,
			false
		);
		if (!suppressed) {
			let count =
				context.globalState.get<number>(activationCountKey, 0) + 1;
			await context.globalState.update(activationCountKey, count);
			const threshold = 10;
			if (count === threshold) {
				const choice = await vscode.window.showInformationMessage(
					"Enjoying AXAML tools from LeXtudio Inc.? Would you like to rate the extension on the Marketplace?",
					"Rate Now",
					"Remind Me Later",
					"Don't Ask Again"
				);
				if (choice === "Rate Now") {
					await vscode.env.openExternal(
						vscode.Uri.parse(
							"https://marketplace.visualstudio.com/items?itemName=lextudio.vscode-axaml&ssr=false#review-details"
						)
					);
					await context.globalState.update(ratingSuppressKey, true); // Don't re-prompt after rating
				} else if (choice === "Don't Ask Again") {
					await context.globalState.update(ratingSuppressKey, true);
				} else if (choice === "Remind Me Later") {
					// Reset counter to prompt again after threshold more activations
					await context.globalState.update(activationCountKey, 0);
				}
			}
		}
	} catch (e) {
		logger.error(`Failed handling rating prompt: ${e}`);
	}

	const commandManager = new CommandManager();
	context.subscriptions.push(
		registerAxamlCommands(commandManager, context)
	);

	// Diagnostics command: show last solution discovery details
	const diagCmd = vscode.commands.registerCommand(
		"axaml.showSolutionDiscoveryInfo",
		async () => {
			const meta = getLastDiscoveryMeta(context);
			if (!meta) {
				vscode.window.showInformationMessage(
					"No solution discovery metadata recorded yet. Building model now..."
				);
				try {
					await buildSolutionModel(context, true);
					const newMeta = getLastDiscoveryMeta(context);
					if (!newMeta) {
						vscode.window.showWarningMessage(
							"Still no metadata after build (possible build failure or no workspace folder)."
						);
						return;
					}
					const rebuiltDetail = `Patterns: ${newMeta.searchedPatterns.join(
						", "
					)}\nMatched: ${
						newMeta.matchedFiles.join("; ") || "(none)"
					}\nSelected: ${
						newMeta.selectedFile || "(none)"
					}\nFallback: ${newMeta.fallbackToRoot}\nTime: ${
						newMeta.timestamp
					}`;
					vscode.window.showInformationMessage(
						"Solution Discovery",
						{ modal: true, detail: rebuiltDetail },
						"OK"
					);
				} catch (e: any) {
					vscode.window.showErrorMessage(
						`Error building solution model: ${e?.message ?? e}`
					);
				}
				return;
			}
			const detail = `Patterns: ${meta.searchedPatterns.join(
				", "
			)}\nMatched: ${
				meta.matchedFiles.join("; ") || "(none)"
			}\nSelected: ${meta.selectedFile || "(none)"}\nFallback: ${
				meta.fallbackToRoot
			}\nTime: ${meta.timestamp}`;
			vscode.window.showInformationMessage(
				"Solution Discovery",
				{ modal: true, detail },
				"OK"
			);
		}
	);
	context.subscriptions.push(diagCmd);

	const openJsonCmd = vscode.commands.registerCommand(
		"axaml.openSolutionModelJson",
		async () => {
			try {
				const p = await getSolutionDataFile();
				if (!p || !(await fs.pathExists(p))) {
					vscode.window.showWarningMessage(
						"Solution model JSON not found yet. Run 'Show solution discovery info' first."
					);
					return;
				}
				const doc = await vscode.workspace.openTextDocument(
					vscode.Uri.file(p)
				);
				await vscode.window.showTextDocument(doc, { preview: false });
			} catch (e: any) {
				vscode.window.showErrorMessage(
					`Cannot open solution model JSON: ${e?.message ?? e}`
				);
			}
		}
	);
	context.subscriptions.push(openJsonCmd);

	if (!vscode.workspace.workspaceFolders) {
		return;
	}

	await selectSolutionOnActivation(context);

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor && util.isAvaloniaFile(editor.document)) {
			// get avalonia previewer panel from tab groups
			const previewTab = vscode.window.tabGroups.all
				.flatMap((tabGroup) => tabGroup.tabs)
				.find((tab) => {
					const tabInput = tab.input as {
						viewType: string | undefined;
					};
					if (!tabInput || !tabInput.viewType) {
						return false;
					}
					return tabInput.viewType.endsWith(
						AppConstants.previewerPanelViewType
					);
				});

			vscode.commands.executeCommand(
				AppConstants.updatePreviewerContent,
				editor.document.uri
			);

			if (
				!previewTab ||
				previewTab?.label.endsWith(
					util.getFileName(editor.document.fileName)
				)
			) {
				return;
			}
		}
	});

	vscode.workspace.onDidSaveTextDocument((document) => {
		if (util.isAvaloniaFile(document)) {
			vscode.commands.executeCommand(
				AppConstants.updatePreviewerContent,
				document.uri
			);
		}
	});

	const insertCmd = vscode.commands.registerTextEditorCommand(
		AppConstants.insertPropertyCommandId,
		(
			textEditor: vscode.TextEditor,
			edit: vscode.TextEditorEdit,
			prop: { repositionCaret: boolean } | undefined
		) => {
			if (prop?.repositionCaret) {
				const cursorPos = textEditor.selection.active;
				const newPos = cursorPos.with(
					cursorPos.line,
					cursorPos.character - 1
				);
				textEditor.selection = new vscode.Selection(newPos, newPos);
			}
			vscode.commands.executeCommand("editor.action.triggerSuggest");
		}
	);
	context.subscriptions.push(insertCmd);

	// LanguageStatusItem for AXAML files: model readiness
	modelStatus = vscode.languages.createLanguageStatusItem(
		"axaml.modelReadiness",
		axamlSelector
	);
	modelStatus.name = "Model Readiness";
	context.subscriptions.push(modelStatus!);

	// LanguageStatusItem for AXAML files: solution selection
	solutionStatus = vscode.languages.createLanguageStatusItem(
		"axaml.solutionSelection",
		axamlSelector
	);
	solutionStatus.name = "Solution Selection";
	solutionStatus.severity = vscode.LanguageStatusSeverity.Information;
	solutionStatus.command = {
		title: "Select",
		command: "axaml.selectSolutionFile",
	};
	context.subscriptions.push(solutionStatus!);

	// Create Language Status Item for AXAML selected project
	axamlProjectStatusItem = vscode.languages.createLanguageStatusItem(
		"axaml.selectedProject",
		"axaml"
	);
	axamlProjectStatusItem.name = "Project";
	axamlProjectStatusItem.severity = vscode.LanguageStatusSeverity.Information;
	context.subscriptions.push(axamlProjectStatusItem!);

	// Helper to update status item
	function updateAxamlProjectStatus() {
		if (!axamlProjectStatusItem) {
			return;
		}
		const selected = context.workspaceState.get<any>(
			AppConstants.selectedExecutableProject
		);
		if (selected && selected.name) {
			axamlProjectStatusItem.text = `$(briefcase) Project: ${selected.name}`;
		} else {
			axamlProjectStatusItem.text = "$(briefcase) No project selected";
		}
	}
	updateAxamlProjectStatus();

	// Register command to re-select project
	context.subscriptions.push(
		vscode.commands.registerCommand("axaml.selectProject", async () => {
			await vscode.commands.executeCommand(
				AppConstants.selectedExecutableProject
			);
			updateAxamlProjectStatus();
		})
	);
	axamlProjectStatusItem.command = {
		title: "Select",
		command: "axaml.selectProject",
	};

	function getSelectedSolutionFileName(): string {
		const meta = getLastDiscoveryMeta(context);
		if (meta && meta.selectedFile) {
			return util.getFileName(meta.selectedFile);
		}
		return "";
	}

	async function triggerSolutionSelection() {
		// Show QuickPick to change solution
		const patterns = ["**/*.slnx", "**/*.sln"];
		let foundFiles: vscode.Uri[] = [];
		for (const pattern of patterns) {
			const files = await vscode.workspace.findFiles(
				pattern,
				undefined,
				50
			);
			if (files.length > 0) {
				foundFiles.push(...files);
			}
		}
		if (foundFiles.length > 0) {
			const sorted = foundFiles
				.map((f) => ({ f, depth: f.fsPath.split(/[\\\/]/).length }))
				.sort(
					(a, b) =>
						a.depth - b.depth ||
						a.f.fsPath.localeCompare(b.f.fsPath)
				);
			const solutionPaths = sorted.map((x) => x.f.fsPath);
			const selected = await vscode.window.showQuickPick(solutionPaths, {
				title: "Change Solution File",
				canPickMany: false,
			});
			if (selected) {
				await setSelectedSolutionSetting(selected);
				refreshLanguageStatus();
			}
		}
	}

	function refreshLanguageStatus() {
		const solutionModel = getSolutionModel(context);
		const solutionFileName = getSelectedSolutionFileName();
		// Model readiness item
		if (modelStatus) {
			if (solutionModel) {
				modelStatus.text = "$(file-media) Cache: Ready";
				modelStatus.detail = "Completion metadata/cache is ready.";
				modelStatus.severity = vscode.LanguageStatusSeverity.Information;
			} else {
				modelStatus.text = "$(file-media) Cache: Not Ready";
				modelStatus.detail = "Build the project to enable autocompletion.";
				modelStatus.severity = vscode.LanguageStatusSeverity.Warning;
			}
		}
		// Solution selection item
		if (solutionStatus) {
			solutionStatus.text = solutionFileName
				? `$(file-code) Solution: ${solutionFileName}`
				: "$(file-code) No solution selected";
		}

		// Selected project status item
		if (axamlProjectStatusItem) {
			const selected = context.workspaceState.get<any>(
				AppConstants.selectedExecutableProject
			);
			if (selected && selected.name) {
				axamlProjectStatusItem.text = `$(briefcase) Project: ${selected.name}`;
			} else {
				axamlProjectStatusItem.text = "$(briefcase) No project selected";
			}
		}
	}

	refreshLanguageStatus();
	// Register command for solution selection (force QuickPick)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"axaml.selectSolutionFile",
			async () => {
				await triggerSolutionSelection();
			}
		)
	);

	// Update status after solution build or asset creation (no QuickPick)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"axaml.updateCompletionStatusBar",
			() => {
				refreshLanguageStatus();
			}
		)
	);

	// Listen for workspace changes that may affect metadata (no QuickPick)
	vscode.workspace.onDidSaveTextDocument((document) => {
		if (util.isAvaloniaFile(document)) {
			buildSolutionModel(context, false);
			refreshLanguageStatus();
		}
	});

	vscode.workspace.onDidChangeWorkspaceFolders(() => {
		buildSolutionModel(context, false);
		refreshLanguageStatus();
	});

	// Rebuild model command (no QuickPick)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"axaml.buildSolutionModel",
			async () => {
				try {
					await buildSolutionModel(context, false);
					refreshLanguageStatus();
				} catch (e: any) {
					vscode.window.showErrorMessage(
						`Failed to rebuild: ${e.message}`
					);
				}
			}
		)
	);

	// Toggle verbose logs (updates config which triggers restart)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"axaml.toggleVerboseLogs",
			async () => {
				const cfg = vscode.workspace.getConfiguration("axaml");
				const current = cfg.get<boolean>(
					"trace.verbose",
					cfg.get<boolean>("verboseLogs", false)
				);
				await cfg.update(
					"trace.verbose",
					!current,
					vscode.ConfigurationTarget.Global
				);
				await cfg.update(
					"verboseLogs",
					!current,
					vscode.ConfigurationTarget.Global
				); // legacy sync
				vscode.window.showInformationMessage(
					`AXAML verbose logs ${
						!current ? "enabled" : "disabled"
					} (server will restart).`
				);
			}
		)
	);

	// Start the appropriate language server based on configuration
	await startLanguageServer(context);

	// React to configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			// Server implementation switch -- prompt user to reload
			if (e.affectsConfiguration("axaml.languageServer")) {
				const choice = await vscode.window.showInformationMessage(
					"The AXAML language server setting has changed. A window reload is required to apply it.",
					"Reload Window"
				);
				if (choice === "Reload Window") {
					await vscode.commands.executeCommand("workbench.action.reloadWindow");
				}
				return;
			}

			// AxamlLanguageServer-specific config changes (only when AXSG is not active)
			if (!axsgService) {
				if (
					e.affectsConfiguration(
						"axaml.completion.buildConfigurationPreference"
					) ||
					e.affectsConfiguration(
						"axaml.buildConfigurationPreference"
					) ||
					e.affectsConfiguration("axaml.trace.verbose") ||
					e.affectsConfiguration("axaml.verboseLogs")
				) {
					try {
						logger.info(
							"Restarting language server due to configuration change..."
						);
						await languageClient?.stop();
						languageClient = await createLanguageService();
						await languageClient.start();
						logger.info(
							"Language server restarted with new configuration preference."
						);
					} catch (err) {
						logger.error(
							`Failed to restart language server: ${err}`
						);
					}
				}
			}
		})
	);
}

/**
 * Starts the appropriate language server based on the current
 * `axaml.languageServer` configuration setting.
 */
async function startLanguageServer(context: vscode.ExtensionContext) {
	// If conflicting extensions are present, avoid starting servers.
	if (checkForConflictingExtensions(context)) {
		logger.info(
			"Conflicting AXAML extensions detected; skipping language server start."
		);
		return;
	}
	const config = vscode.workspace.getConfiguration("axaml");
	const preferred = config.get<string>(
		"languageServer",
		"XamlToCSharpGenerator"
	);

	if (preferred === "XamlToCSharpGenerator") {
		try {
			axsgService = await createAxsgLanguageService(context);
			// Eagerly start if a XAML/AXAML file is already visible
			if (
				vscode.window.visibleTextEditors.some(
					(e) =>
						e.document.languageId === "axaml"/* ||
						e.document.languageId === "xaml" */
				)
			) {
				await axsgService.ensureStarted();
			}
			logger.info("AXSG language service activated.");
		} catch (error) {
			logger.error(`Failed to start AXSG language service. ${error}`);
			logger.show();
		}
		applyServerSpecificStatusItems(true);
	} else {
		try {
			languageClient = await createLanguageService();
			logger.info("Starting AXAML Language Server...");
			await languageClient.start();
		} catch (error) {
			logger.error(
				`Failed to start AXAML Language Server. ${error}`
			);
			logger.show();
		}
		applyServerSpecificStatusItems(false);
	}
}

/**
 * Stops whichever language server is currently active.
 */
async function stopActiveLanguageServer() {
	if (axsgService) {
		await axsgService.stop();
		axsgService = null;
	}
	if (languageClient) {
		await languageClient.stop();
		languageClient = null;
	}
}

// This method is called when your extension is deactivated
export async function deactivate() {
	await stopActiveLanguageServer();
	logger.info("Language client stopped");
}
