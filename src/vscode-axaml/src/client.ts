import * as vscode from "vscode";
import * as lsp from "vscode-languageclient/node";
import { getDotnetRuntimePath, getLanguageServerPath as getAvaloniaServerPath } from "./runtimeManager";
import { avaloniaLanguageId, logger } from "./util/utilities";

export async function createLanguageService(): Promise<lsp.LanguageClient> {
	logger.info("Creating language service");

	const serverOptions = await getServerStartupOptions();
	let outputChannel = logger;

	const axamlCfg = vscode.workspace.getConfiguration("axaml");
	const pref = axamlCfg.get<string>("completion.buildConfigurationPreference", axamlCfg.get<string>("buildConfigurationPreference", "Auto"));
	const verbose = axamlCfg.get<boolean>("trace.verbose", axamlCfg.get<boolean>("verboseLogs", false));
	const clientOptions: lsp.LanguageClientOptions = {
		documentSelector: [{ language: avaloniaLanguageId }],
		progressOnInitialization: true,
		outputChannel,
		initializationOptions: {
			buildConfigurationPreference: pref,
			verboseLogs: verbose,
			workspaceRoot: vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined
		},
		synchronize: {
			configurationSection: "axaml",
			fileEvents: vscode.workspace.createFileSystemWatcher("**/*.axaml"),
		},
		middleware: {
			provideDocumentFormattingEdits: (document, options, token, next) =>
				next(
					document,
					{
						...options,
						insertFinalNewline: true,
					},
					token
				),
		},
	};

	const client = new lsp.LanguageClient(avaloniaLanguageId, "AXAML LSP", serverOptions, clientOptions);

	return client;
}

async function getServerStartupOptions(): Promise<lsp.ServerOptions> {
	const dotnetCommandPath = await getDotnetRuntimePath();
	const serverPath = getAvaloniaServerPath();

	// Log resolved paths for easier troubleshooting
	logger.info(`[AXAML LSP] dotnet: ${dotnetCommandPath}`);
	logger.info(`[AXAML LSP] Language server DLL: ${serverPath}`);

	const executable = {
		command: dotnetCommandPath,
		args: [serverPath],
		options: {
			env: process.env,
		},
	};

	return {
		run: executable,
		debug: executable,
	};
}
