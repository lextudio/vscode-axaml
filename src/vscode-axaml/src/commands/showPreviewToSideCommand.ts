import * as vscode from "vscode";
import { Command } from "../commandManager";
import { logger } from "../util/utilities";
import { PreviewerData, ShowPreviewSettings } from "../models/previewerSettings";
import { PreviewProcessManager } from "../previewProcessManager";
import { WebPreviewerPanel } from "../panels/webPreviewerPanel";
import AppConstants from "../util/constants";


export class ShowPreviewToSideCommand implements Command {
	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _processManager: PreviewProcessManager
	) {}
	public readonly id = AppConstants.showPreviewToSideCommand;

	public async execute(mainUri?: vscode.Uri, allUris?: vscode.Uri[]) {
		const activeFile = mainUri ?? vscode.window.activeTextEditor?.document.uri;

		let previewerData = this._processManager.getPreviewerData(activeFile?.toString() ?? "");

		if (!previewerData) {
			previewerData = await vscode.commands.executeCommand<PreviewerData>(
				AppConstants.previewProcessCommandId,
				activeFile
			);
		}

		if (!previewerData.assetsAvailable) {
			const result = await vscode.window.showInformationMessage(
				"Previewer is not available. Build the project first.",
				"Build",
				"Close"
			);

			if (result === "Build") {
				await vscode.commands.executeCommand(AppConstants.previewerAssetsCommand);
				await vscode.commands.executeCommand(AppConstants.showPreviewToSideCommand, previewerData.file);
			}

			return;
		}

		showPreview(this._context, { sideBySide: true }, previewerData, this._processManager);

		new Promise((resolve) => setTimeout(resolve, 1000)).then(() => {
			vscode.commands.executeCommand(AppConstants.updatePreviewerContent, activeFile);
		});
	}
}

export function showPreview(
	context: vscode.ExtensionContext,
	settings: ShowPreviewSettings,
	previewerData: PreviewerData,
	processManager: PreviewProcessManager
) {
	let uri = previewerData.file;
	if (uri) {
		logger.info(`Show Preview to side: ${uri.toString()}`);
	}
	else {
		logger.error('no mainUri');
	}

	if (!(uri instanceof vscode.Uri)) {
		if (vscode.window.activeTextEditor) {
			uri = vscode.window.activeTextEditor.document.uri;
		}
		else { return; }
	}

	if (uri) {
		const resourceColumn =
			(vscode.window.activeTextEditor && vscode.window.activeTextEditor.viewColumn) || vscode.ViewColumn.One;
		const column = settings.sideBySide ? vscode.ViewColumn.Beside : resourceColumn;

		const mode = (previewerData.transportMode
			?? vscode.workspace.getConfiguration().get<string>(AppConstants.previewerTransportModeKey, "html")
		) as "html" | "tcp";

		WebPreviewerPanel.createOrShow(
			previewerData.previewerUrl!,
			previewerData.file,
			context.extensionUri,
			previewerData.targetPath!,
			processManager,
			column,
			mode
		);
	}
}
