import * as vscode from "vscode";
import { Command } from "../commandManager";
import { AppConstants } from "../util/constants";
import * as util from "../util/utilities";
import { PreviewServer } from "../services/previewServer";
import { WebPreviewerPanel } from "../panels/webPreviewerPanel";

export class UpdatePreviewerContext implements Command {
	constructor(private readonly _context: vscode.ExtensionContext) {}
	public readonly id = AppConstants.updatePreviewerContent;

	public async execute(mainUri?: vscode.Uri, allUris?: vscode.Uri[]) {
		// Prevent updating preview when conflicting extensions are present
		if (util.hasConflictingExtensions()) {
			return;
		}
		if (!mainUri) {
			return;
		}

		const fileData = util.getFileDetails(mainUri.fsPath, this._context);
		if (!fileData) {
			return;
		}

		const xamlText = await this.getTextFromUri(mainUri);
		PreviewServer.getInstanceByAssemblyName(fileData.targetPath)?.updateXaml(fileData, xamlText);
		WebPreviewerPanel.updateTitle(mainUri);
	}

	async getTextFromUri(uri: vscode.Uri): Promise<string> {
		const buffer = await vscode.workspace.fs.readFile(uri);
		return buffer.toString();
	}
}
