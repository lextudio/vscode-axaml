import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { logger } from "./util/Utilities";
import AppConstants from "./util/Constants";

/**
 * The .NET major version to acquire. Change to 10.0 to request .NET 10.
 */
const dotnetRuntimeVersion = "10.0";

interface IDotnetAcquireResult {
    dotnetPath: string;
}

/**
 * Gets the path to the .NET runtime.
 * @returns A promise that resolves to the path to the .NET runtime.
 * @throws An error if the .NET runtime path could not be resolved.
 */
export async function getDotnetRuntimePath(): Promise<string> {
	const path = await vscode.commands.executeCommand<IDotnetAcquireResult>("dotnet.findPath", {
		acquireContext: {
			version: dotnetRuntimeVersion,
			requestingExtensionId: AppConstants.extensionId,
			mode: 'runtime',
			installType: 'global',
			architecture: process.arch
		},
		versionSpecRequirement: 'equal'
	});

	if (!path) {
		const install = await vscode.commands.executeCommand("dotnet.acquire", {
			version: dotnetRuntimeVersion,
			requestingExtensionId: AppConstants.extensionId,
			mode: 'runtime',
			installType: 'global',
			architecture: process.arch
		});
		if (!install) {
			const message = `.NET ${dotnetRuntimeVersion} was not found and could not be installed automatically. Please make sure it's installed globally.`;
			logger.error(message);
			throw new Error(message);
		}
	}

	return path.dotnetPath;
}

/**
 * Gets the path to the AXAML language server.
 * @returns The path to the AXAML language server.
 * @throws An error if the extension could not be found.
 */
export function getLanguageServerPath() {
	const avaloniaExtn = vscode.extensions.getExtension(AppConstants.extensionId);
	if (!avaloniaExtn) {
		throw new Error("Could not find AXAML extension.");
	}
	const config = vscode.workspace.getConfiguration('axaml');
	const overridePath = config.get<string>('languageServerPath');
	if (overridePath && overridePath.trim().length > 0) {
		if (fs.existsSync(overridePath)) {
			return overridePath;
		}
		logger.warn(`Configured axaml.languageServerPath does not exist: ${overridePath}. Falling back to built-in server selection.`);
	}
	const preferred = config.get<string>('languageServer') || 'AxamlLanguageServer';
	const extServerDirAxaml = path.join(avaloniaExtn.extensionPath, 'axamlServer');
	const extServerDirAxsg = path.join(avaloniaExtn.extensionPath, 'axsgServer');

	const candidates: string[] = [];
	if (preferred === 'XamlToCSharpGenerator') {
		// Prefer files in axsgServer
		candidates.push(path.join(extServerDirAxsg, 'XamlToCSharpGenerator.LanguageServer.dll'));
		candidates.push(path.join(extServerDirAxsg, 'XamlToCSharpGenerator.LanguageServer'));
	} else {
		// Prefer AxamlLanguageServer in axamlServer
		candidates.push(path.join(extServerDirAxaml, 'AxamlLanguageServer.dll'));
		candidates.push(path.join(extServerDirAxaml, 'AxamlLanguageServer'));
	}

	for (const c of candidates) {
		if (fs.existsSync(c)) {
			return c;
		}
	}

	throw new Error(`Could not find a language server binary. Checked: ${candidates.join(', ')}.`);
}
