import * as vscode from "vscode";
import { CommandManager } from "../commandManager";
import { ShowPreviewToSideCommand } from "./ShowPreviewToSideCommand";
import { CreatePreviewerAssets } from "./createPreviewerAssets";
import { PreviewerProcess } from "./previewerProcess";
import { PreviewProcessManager } from "../previewProcessManager";
import { UpdatePreviewerContext } from "./updatePreviewerContent";
import { CreateNewProject } from "./createNewProject";
import { SelectAvaloniaProject } from "./SelectAvaloniaProject";
import { OpenDesignerCommand } from "./openDesigner";

const processManager = new PreviewProcessManager();

export function registerAxamlCommands(
	commandManager: CommandManager,
	context: vscode.ExtensionContext
): vscode.Disposable {
	commandManager.register(new CreateNewProject());
	commandManager.register(new ShowPreviewToSideCommand(context, processManager));
	commandManager.register(new CreatePreviewerAssets(context));
	commandManager.register(new PreviewerProcess(context, processManager));
	commandManager.register(new UpdatePreviewerContext(context));
	commandManager.register(new SelectAvaloniaProject(context));
	commandManager.register(new OpenDesignerCommand(context));

	return commandManager;
}
