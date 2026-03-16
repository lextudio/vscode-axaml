import * as vscode from "vscode";
import { Command } from "../commandManager";
import * as util from "../util/utilities";
import { PreviewerParams } from "../models/previewerParams";
import { spawn } from "child_process";

import * as portfinder from "portfinder";
import * as fs from "fs";
import { PreviewerData } from "../models/previewerSettings";
import { PreviewProcessManager } from "../previewProcessManager";
import { PreviewServer } from "../services/previewServer";
import AppConstants from "../util/constants";

export class PreviewerProcess implements Command {
	id: string = AppConstants.previewProcessCommandId;

	async execute(mainUri?: vscode.Uri): Promise<PreviewerData> {
		// Prevent starting preview when conflicting extensions are present
		if (util.hasConflictingExtensions()) {
			vscode.window.showWarningMessage(
				"Preview is disabled because another AXAML extension is installed. Please uninstall conflicting extensions to enable preview."
			);
			return { file: mainUri!, previewerUrl: "", assetsAvailable: false };
		}
		util.logger.info(`Command ${this.id}, ${mainUri}`);
		let result: PreviewerData = { file: mainUri! };
		const previewParams = this._context.workspaceState.get<PreviewerParams>(AppConstants.previewerParamState);
		util.logger.info(`PreviewerParams: ${JSON.stringify(previewParams, null, 2)}`);
		if (!previewParams || Object.values(previewParams).some(v => !v)) {
			util.logger.error('PreviewerParams are missing or empty. Check asset generation and solution parsing steps.');
		}
		if (previewParams && mainUri) {
			result = await this.startPreviewerProcess(previewParams, mainUri);
		}
		return result;
	}

	async startPreviewerProcess(previewParams: PreviewerParams, mainUri: vscode.Uri): Promise<PreviewerData> {
		if (!this.canStartPreviewerProcess(previewParams)) {
			util.logger.error(`Previewer assets are not available.`);
			return { file: mainUri, previewerUrl: "", assetsAvailable: false };
		}

		const fileData = util.getFileDetails(mainUri.fsPath, this._context);

		if (!fileData) {
			// TODO: this should trigger an auto rebuild? No. Empty .axaml file hits it.
			return { file: mainUri, previewerUrl: "", assetsAvailable: false };
		}

		const previewerData = this._processManager.getPreviewerData(fileData.targetPath);
		if (previewerData) {
			util.logger.info(`Previewer process already started: ${previewerData.pid}`);
			return previewerData;
		}

		const transportMode = vscode.workspace.getConfiguration()
			.get<string>(AppConstants.previewerTransportModeKey, "html") as "html" | "tcp";
		const isTcp = transportMode === "tcp";

		const firstPort = await portfinder.getPortPromise();
		const bsonPort = isTcp ? firstPort : firstPort + 1;
		const httpPort = isTcp ? 0 : firstPort;
		const htmlUrl = isTcp ? "" : `${AppConstants.htmlUrl}:${httpPort}`;
		const assemblyPath = fileData.targetPath;

		const server = PreviewServer.getInstance(assemblyPath, bsonPort);
		if (!server.isRunning) {
			await server.start();
			console.log(`Preview server started on port ${bsonPort}`);
		}

		const previewerArgs = [
			"exec",
			`--runtimeconfig "${previewParams.projectRuntimeConfigFilePath}"`,
			`--depsfile "${previewParams.projectDepsFilePath}" "${previewParams.previewerPath}"`,
			"--method avalonia-remote",
			`--transport tcp-bson://${AppConstants.localhost}:${bsonPort}/`,
			...(isTcp ? [] : [
				"--method html",
				`--html-url ${htmlUrl}`,
			]),
			previewParams.targetPath.putInQuotes(),
		];

		const startTime = Date.now();

		return new Promise<PreviewerData>((resolve, reject) => {
			const previewer = spawn("dotnet", previewerArgs, {
				env: process.env,
				shell: true,
			});

			previewer.on("spawn", () => {
				util.logger.info(`Previewer process started with args: ${previewerArgs}`);
				const previewerData: PreviewerData = {
					file: mainUri,
					previewerUrl: htmlUrl,
					assetsAvailable: true,
					pid: previewer.pid,
					wsAddress: isTcp ? "" : AppConstants.webSocketAddress(httpPort),
					targetPath: previewParams.targetPath,
					transportMode,
				};
				this._processManager.addProcess(assemblyPath, previewerData);
				resolve(previewerData);
			});

			// OS-level failure (dotnet not on PATH, permission denied, etc.)
			previewer.on("error", (err) => {
				util.logger.error(`Failed to start previewer: ${err.message}`);
				this._processManager.removeProcess(assemblyPath);
				reject(err);
			});

			previewer.stdout.on("data", (data) => {
				util.logger.info(data.toString());
			});

			// Log stderr but never reject — .NET runtimes write warnings here
			previewer.stderr.on("data", (data) => {
				util.logger.error(data.toString());
			});

			previewer.on("close", (code, signal) => {
				const lifetime = Date.now() - startTime;
				util.logger.info(
					`Previewer process exited: code=${code} signal=${signal} lifetime=${lifetime}ms`
				);

				// Clean up the stale entry so the next preview attempt can start fresh
				this._processManager.removeProcess(assemblyPath);

				const isAbnormal = code !== 0 || signal !== null;
				if (isAbnormal) {
					const reason = signal
						? `signal ${signal}`
						: `exit code ${code}`;
					server.dispatchError(reason);

					// Fast-fail: process died within 5 s — likely a startup error
					if (lifetime < 5000) {
						vscode.window.showErrorMessage(
							`Previewer failed to start (${reason}). Check the AXAML output log for details.`,
							"Show Log"
						).then((choice) => {
							if (choice === "Show Log") {
								util.logger.show();
							}
						});
					}
				}
			});
		});
	}

	canStartPreviewerProcess(previewParams: PreviewerParams) {
		util.logger.info('Checking existence of previewer assets:');
		util.logger.info(`  previewerPath: ${previewParams.previewerPath} => ${fs.existsSync(previewParams.previewerPath)}`);
		util.logger.info(`  projectRuntimeConfigFilePath: ${previewParams.projectRuntimeConfigFilePath} => ${fs.existsSync(previewParams.projectRuntimeConfigFilePath)}`);
		util.logger.info(`  projectDepsFilePath: ${previewParams.projectDepsFilePath} => ${fs.existsSync(previewParams.projectDepsFilePath)}`);
		util.logger.info(`  targetPath: ${previewParams.targetPath} => ${fs.existsSync(previewParams.targetPath)}`);
		const result =
			fs.existsSync(previewParams.previewerPath) &&
			fs.existsSync(previewParams.projectRuntimeConfigFilePath) &&
			fs.existsSync(previewParams.projectDepsFilePath) &&
			fs.existsSync(previewParams.targetPath);
		if (!result) {
			util.logger.error('One or more previewer assets are missing. See above for details.');
		}
		return result;
	}
	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _processManager: PreviewProcessManager
	) {}
}
