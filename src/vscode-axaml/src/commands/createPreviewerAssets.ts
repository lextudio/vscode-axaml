import * as vscode from "vscode";
import { Command } from "../commandManager";
import { logger } from "../util/utilities";
import * as fs from "fs-extra";
import * as path from "path";
import { spawn } from "child_process";
import { PreviewerParams } from "../models/previewerParams";
import * as sln from "../services/solutionParser";
import * as sm from "../models/solutionModel";
import AppConstants from "../util/constants";

export class CreatePreviewerAssets implements Command {
	public readonly id = AppConstants.previewerAssetsCommand;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	async execute(
		args: { triggerCodeComplete: boolean } | undefined
	): Promise<void> {
		if (!vscode.workspace.workspaceFolders) {
			logger.error("No active workspace.");
			logger.show();
			return;
		}

		const project: sm.Project | undefined =
			this._context.workspaceState.get<sm.Project | undefined>(
				AppConstants.selectedExecutableProject,
				undefined
			);
		if (!project) {
			await vscode.commands.executeCommand("axaml.selectProject");
			return;
		}

		const projectPath = project.path;

		if (projectPath && fs.pathExistsSync(projectPath)) {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					cancellable: false,
				},
				async (progress) => {
					progress.report({ message: "Building the project..." });

					const output = await this.generatePreviewerAssets(
						projectPath,
						project!
					);
					this._context.workspaceState.update(
						AppConstants.previewerParamState,
						output
					);

					logger.info(
						`Previewer assets generated at ${output.previewerPath}`
					);
					if (output.previewerPath.trim() === "") {
						// if previewer asset generation failed, yank UI focus to our logger channel.
						logger.error("Previewer path is empty");
						logger.show();
					}
				}
			);
		}
		if (args?.triggerCodeComplete) {
			vscode.commands.executeCommand(
				AppConstants.insertPropertyCommandId,
				{ repositionCaret: true }
			);
		}
	}

	generatePreviewerAssets(
		projectPath: string,
		project: sm.Project
	): Promise<PreviewerParams> {
		return new Promise((resolve, reject) => {
			const cfg = vscode.workspace.getConfiguration();
			const runInfo = cfg.get<boolean>(
				"axaml.previewer.runDotnetInfo",
				cfg.get<boolean>("axaml.buildRunDotnetInfo", false)
			);
			const projectDir = path.dirname(projectPath);
			const emitBinlog = cfg.get<boolean>(
				"axaml.previewer.emitBinlog",
				cfg.get<boolean>("axaml.buildEmitBinlog", false)
			);
			const startBuild = () => {
				const buildArgs = ["build", projectPath, "-nologo"];
				if (emitBinlog) {
					buildArgs.splice(2, 0, "-bl:msbuild.binlog");
				}
				logger.info(`[diagnostics] build cwd: ${projectDir}`);
				logger.info(`[diagnostics] dotnet ${buildArgs.join(" ")}`);
				const dotnet = spawn("dotnet", buildArgs, { cwd: projectDir });
				dotnet.stderr.on("data", (data) =>
					logger.error(`[ERROR]  dotnet build error: ${data}`)
				);
				dotnet.stdout.on("data", (data) => logger.info(`${data}`));
				dotnet.on("close", async (code) => {
					if (code === 0) {
						// TODO: revisit the conditions
						// if (
						// 	!project.designerHostPath ||
						// 	project.designerHostPath === ""
						// ) {
							await sln.buildSolutionModel(this._context, true);
						//}
						const solution = sln.getSolutionModel(this._context);
						if (!solution) {
							return reject("Solution data not found.");
						}
						var cached = this._context.workspaceState.get<
							sm.Project | undefined
						>(AppConstants.selectedExecutableProject, undefined);
						if (!cached) {
							return reject("Selected project not found.");
						}
						const prj = solution.projects.find(p => p.name === cached!.name);
						if (!prj) {
							return reject("Project not found in solution.");
						}
						resolve({
							previewerPath: prj.designerHostPath,
							targetPath: prj.targetPath,
							projectRuntimeConfigFilePath:
								prj.runtimeConfigFilePath,
							projectDepsFilePath: prj.depsFilePath,
						});
					} else {
						logger.error(
							`[ERROR] dotnet build exited with code ${code}`
						);
						reject(`dotnet build exited with code ${code}`);
					}
				});
			};
			if (runInfo) {
				logger.info(
					"[diagnostics] Running 'dotnet --info' before build..."
				);
				const info = spawn("dotnet", ["--info"]);
				let infoOutput = "";
				info.stdout.on("data", (d) => {
					infoOutput += d.toString();
				});
				info.stderr.on("data", (d) => {
					infoOutput += d.toString();
				});
				info.on("close", () => {
					infoOutput
						.split(/\r?\n/)
						.forEach(
							(line) =>
								line && logger.info(`[dotnet-info] ${line}`)
						);
					logger.info(
						"[diagnostics] dotnet --info completed. Starting project build..."
					);
					startBuild();
				});
			} else {
				startBuild();
			}
		});
	}
	constructor(private readonly _context: vscode.ExtensionContext) {}
}
