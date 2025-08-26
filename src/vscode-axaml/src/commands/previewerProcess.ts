import * as vscode from "vscode";
import { Command } from "../commandManager";
import * as util from "../util/Utilities";
import { PreviewerParams } from "../models/PreviewerParams";
import { spawn } from "child_process";

import * as portfinder from "portfinder";
import * as fs from "fs";
import { PreviewerData } from "../models/previewerSettings";
import { PreviewProcessManager } from "../previewProcessManager";
import { PreviewServer } from "../services/previewServer";
import AppConstants from "../util/Constants";

export class PreviewerProcess implements Command {
	id: string = AppConstants.previewProcessCommandId;

	async execute(mainUri?: vscode.Uri): Promise<PreviewerData> {
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

		const httpPort = await portfinder.getPortPromise();
		const bsonPort = httpPort + 1; //await portfinder.getPortPromise({ startPort: 9000 });
		const htmlUrl = `${AppConstants.htmlUrl}:${httpPort}`;
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
			"--method html",
			`--html-url ${htmlUrl}`,
			previewParams.targetPath.putInQuotes(),
		];

		return new Promise((resolve, reject) => {
			const previewer = spawn("dotnet", previewerArgs, {
				env: process.env,
				shell: true,
			});

			previewer.on("spawn", () => {
				util.logger.info(`Previewer process started with args: ${previewerArgs}`);
				let wsAddress = AppConstants.webSocketAddress(httpPort);
				let previewerData: PreviewerData = {
					file: mainUri,
					previewerUrl: htmlUrl,
					assetsAvailable: true,
					pid: previewer.pid,
					wsAddress: wsAddress,
					targetPath: previewParams.targetPath
				};
				this._processManager.addProcess(assemblyPath, previewerData);
				resolve(previewerData);
			});

			previewer.stdout.on("data", (data) => {
				util.logger.info(data.toString());
			});

			previewer.stderr.on("data", (data) => {
				util.logger.error(data.toString());
				reject(data.toString());
			});

			previewer.on("close", (code, signal) => {
				util.logger.info(`Previewer process exited with code ${code} and signal ${signal}`);
				if (signal === "SIGABRT") {
					util.logger.info(`Previewer process was aborted`);
					server.dispatchError(signal);
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
