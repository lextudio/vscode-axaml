import * as vscode from "vscode";
import { Command } from "../commandManager";
import * as sm from "../models/solutionModel";
import * as sln from "../services/solutionParser";
import AppConstants from "../util/constants";
import { logger, getExecutableProjects } from "../util/utilities";


export class SelectAvaloniaProject implements Command {
	public readonly id = AppConstants.selectedExecutableProject;
	constructor(private readonly _context: vscode.ExtensionContext) { }
	async execute(): Promise<void> {
		await sln.buildSolutionModel(this._context, true);
		const solutionData = sln.getSolutionModel(this._context);
		const projects = getExecutableProjects(solutionData!);
		let project: sm.Project | undefined = undefined;
		if (projects.length === 1) {
			project = projects[0];
		} else {
			type ProjectPick = {
				label: string;
				description: string;
				project: sm.Project;
			};
			const items: ProjectPick[] = projects.map((p: any) => ({
				label: p.name,
				description: p.path,
				project: p,
			}));
			const selected = await vscode.window.showQuickPick<ProjectPick>(
				items,
				{
					placeHolder: "Select the project to use for previewer and autocompletion",
				}
			);
			if (!selected) {
				logger.error("No project selected by user.");
				logger.show();
				return;
			}
			project = selected.project;
		}
		if (!project) {
			logger.error("No project found.");
			logger.show();
			return;
		}
		this._context.workspaceState.update(
			AppConstants.selectedExecutableProject,
			project
		);
		vscode.window.showInformationMessage(`Selected Avalonia project: ${project.name}`);
	}
}
