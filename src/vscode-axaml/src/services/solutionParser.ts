import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

import * as vscode from "vscode";
//import "vscode"; // required for 'using' statement. Type 'Disposable' must be in global namespace.

import * as sln from "../models/solutionModel";
import { spawn } from "child_process";

import { logger, getFileName } from "../util/utilities";
import { getDotnetRuntimePath } from "../runtimeManager";
import AppConstants from "../util/constants";

/**
 * Builds the solution model by parsing the solution file and updating the workspace state.
 * If the output file already exists and `force` is false, the function does nothing.
 * @param context The extension context.
 * @param force Whether to force the parsing of the solution file even if the output file already exists.
 */
export async function buildSolutionModel(context: vscode.ExtensionContext, force: boolean = false) {
	var { outputPath, isExist } = await isOutputExists();

	if (!isExist || force) {
		logger.info(`[SolutionModel] parsing required (exists=${isExist}, force=${force})`);
		logger.info(`[SolutionModel] Starting asset generation and solution parsing.`);
		await parseSolution(context);
		return;
	}

	const fileContent = await fs.readFile(outputPath!, "utf-8");
	const size = Buffer.byteLength(fileContent, "utf8");
	const hash = crypto.createHash("sha256").update(fileContent).digest("hex").slice(0, 12);
	logger.info(`[SolutionModel] using cached JSON size=${size}B hash=${hash}`);
	updateSolutionModel(context, fileContent);
}

/**
 * Returns the solution model from the workspace state.
 * @param context The extension context.
 * @returns The solution model, or undefined if it doesn't exist.
 */
export function getSolutionModel(context: vscode.ExtensionContext): sln.Solution | undefined {
	const solutionData = context.workspaceState.get<sln.Solution | undefined>(AppConstants.solutionData, undefined);
	return solutionData;
}

/**
 * Returns the path to the solution data file.
 * @returns The path to the solution data file, or undefined if it doesn't exist.
 */
export async function getSolutionDataFile() {
	const slnFile = await getSolutionFile();
	if (!slnFile) {
		logger.error("Could not find solution file.");
		return;
	}

	return path.join(os.tmpdir(), `${path.basename(slnFile)}.json`);
}

/**
 * Deletes the solution data file.
 */
export async function purgeSolutionDataFile() {
	const solutionDataFile = await getSolutionDataFile();
	if (!solutionDataFile) {
		return;
	}
	fs.removeSync(solutionDataFile);
}

function updateSolutionModel(context: vscode.ExtensionContext, jsonContent: string) {
	const data = JSON.parse(jsonContent);
	context.workspaceState.update(AppConstants.solutionData, data);
	logger.info(`[SolutionModel] Updated workspaceState with solutionData: ${JSON.stringify(data, null, 2)}`);
}

interface SolutionDiscoveryMeta {
	searchedPatterns: string[];
	matchedFiles: string[];
	selectedFile?: string;
	fallbackToRoot: boolean;
	timestamp: string;
}

export function getLastDiscoveryMeta(context: vscode.ExtensionContext): SolutionDiscoveryMeta | undefined {
	return context.workspaceState.get<SolutionDiscoveryMeta>(AppConstants.solutionDiscoveryMeta);
}

async function recordDiscovery(context: vscode.ExtensionContext | undefined, meta: SolutionDiscoveryMeta) {
	if (!context) { return; }
	try { await context.workspaceState.update(AppConstants.solutionDiscoveryMeta, meta); } catch { /* ignore */ }
}

// Helper to get/set selected solution in workspace configuration
const SOLUTION_SETTING_KEY = "axaml.selectedSolution";
function getSelectedSolutionSetting(): string | undefined {
	return vscode.workspace
		.getConfiguration()
		.get<string>(SOLUTION_SETTING_KEY);
}

export async function setSelectedSolutionSetting(solutionPath: string) {
	await vscode.workspace
		.getConfiguration()
		.update(
			SOLUTION_SETTING_KEY,
			solutionPath,
			vscode.ConfigurationTarget.Workspace
		);
}

export async function selectSolutionOnActivation(context: vscode.ExtensionContext) {
	// Try getting solution file from extension exports first
	const extensionIds = [
		"ms-dotnettools.csharp",
		"Ionide.Ionide-fsharp",
		"ms-dotnettools.csdevkit"
	];
	for (const extId of extensionIds) {
		try {
			const ext = vscode.extensions.getExtension(extId);
			if (ext && ext.exports) {
				// Try known export properties
				if (ext.exports.CSharpExtensionExports?.workspace?.solutionPath) {
					logger.info(`[SolutionDiscovery] Found solution from CSharpExtensionExports: ${ext.exports.CSharpExtensionExports.workspace.solutionPath}`);
					await setSelectedSolutionSetting(ext.exports.CSharpExtensionExports.workspace.solutionPath);
					return;
				}
				if (ext.exports.OmnisharpExtensionExports?.workspace?.solutionPath) {
					logger.info(`[SolutionDiscovery] Found solution from OmnisharpExtensionExports: ${ext.exports.OmnisharpExtensionExports.workspace.solutionPath}`);
					await setSelectedSolutionSetting(ext.exports.OmnisharpExtensionExports.workspace.solutionPath);
					return;
				}
				if (ext.exports.workspace?.solutionPath) {
					logger.info(`[SolutionDiscovery] Found solution from workspace.solutionPath: ${ext.exports.workspace.solutionPath}`);
					await setSelectedSolutionSetting(ext.exports.workspace.solutionPath);
					return;
				}
			}
		} catch (err) {
			logger.error(`[SolutionDiscovery] Error accessing exports for ${extId}: ${err}`);
		}
	}

	// Fallback to file search
	const patterns = ["**/*.slnx", "**/*.sln"];
	const matched: string[] = [];
	let foundFiles: vscode.Uri[] = [];
	for (const pattern of patterns) {
		const files = await vscode.workspace.findFiles(pattern, undefined, 50);
		logger.info(`[SolutionDiscovery] pattern=${pattern} count=${files.length}`);
		if (files.length > 0) {
			foundFiles.push(...files);
		}
	}
	let selected: string | undefined = getSelectedSolutionSetting();
	if (foundFiles.length > 0) {
		// Sort by depth, then alphabetically
		const sorted = foundFiles
			.map(f => ({ f, depth: f.fsPath.split(/[\\\/]/).length }))
			.sort((a, b) => a.depth - b.depth || a.f.fsPath.localeCompare(b.f.fsPath));
		matched.push(...foundFiles.map(f => f.fsPath));
		// If not set or invalid, select the shallowest solution automatically
		if (!selected || !matched.includes(selected)) {
			selected = sorted[0].f.fsPath;
			logger.info(`[SolutionDiscovery] auto chosen=${selected}`);
			await setSelectedSolutionSetting(selected);
		}
		await recordDiscovery(context, {
			searchedPatterns: patterns,
			matchedFiles: matched,
			selectedFile: selected,
			fallbackToRoot: false,
			timestamp: new Date().toISOString()
		});
	} else {
		// Fallback to workspace root
		const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		logger.info(`[SolutionDiscovery] fallbackRoot=${root}`);
		await setSelectedSolutionSetting(root ?? "");
		await recordDiscovery(context, {
			searchedPatterns: patterns,
			matchedFiles: matched,
			selectedFile: root,
			fallbackToRoot: true,
			timestamp: new Date().toISOString()
		});
	}
}

async function getSolutionFile(): Promise<string | undefined> {
	// Only return the selected solution from workspace settings
	return vscode.workspace.getConfiguration("axaml").get<string>("selectedSolution");
}

async function isOutputExists() {
	const outputPath = await getSolutionDataFile();
	logger.info(`[EXT - INFO] Solution data path: ${outputPath}`);
	return { outputPath, isExist: fs.pathExistsSync(outputPath!) };
}

async function parseSolution(context: vscode.ExtensionContext): Promise<string> {
	const solutionPath = await getSolutionFile();
	if (!solutionPath) {
		logger.error("Could not find solution file. Previewer asset generation will fail.");
		throw new Error("Could not find solution file.");
	}

	const parserLocation = path.join(context.extensionPath, "solutionParserTool", "SolutionParser.dll");

	return new Promise<string>(async (resolve, reject) => {
		let dotnetCommandPath: string;
		try {
			dotnetCommandPath = await getDotnetRuntimePath();
		}
		catch (error) {
			reject(error);
			return;
		}

		let jsonContent = "";
		const previewer = spawn(dotnetCommandPath.putInQuotes(), [parserLocation.putInQuotes(), solutionPath.putInQuotes()], {
			windowsVerbatimArguments: false,
			env: process.env,
			shell: true,
		});

		previewer.on("spawn", () => {
			jsonContent = "";
			logger.info(`parser process args: ${previewer.spawnargs}`);
		});

		previewer.stdout.on("data", (data) => {
			jsonContent += data.toString();
		});

		let errorData = "";

		previewer.stderr.on("data", (data) => {
			logger.error(data.toString());
			errorData += data.toString();
		});

		previewer.on("close", (code) => {
			logger.info(`parser process exited with code ${code}`);

			if (code === 0) {
				try {
					updateSolutionModel(context, jsonContent);
				}
				catch (error) {
					reject(error);
				}
				resolve(jsonContent);
			}			
			else {
				if (errorData.length === 0) {
					errorData = `Solution parser process exited with code ${code}`;
				}
				reject(new Error(errorData));
			}
		});
	});
}
