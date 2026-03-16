const { contributes } = require("../../package.json");

/**
 * Various app constants
 */
export namespace AppConstants {
    export const contributions = contributes;
    // todo: implement instance methods using this configuration object to read/write workspace settings. This feels like it should be part of VSCode's API.
    export const allConfigurationIDs = contributions.configuration;
    // todo: use this for API tests! Compare returned array to explicitly defined constants.
    export const allCommandIDs = contributions.commands.map((v: any) => v.command);

    export const insertPropertyCommandId = "axaml.InsertProperty";
    export const previewerParamState = "previewerParams";
    export const previewProcessCommandId = "axaml.previewProcess";
    export const localhost = "127.0.0.1";
    export const htmlUrl = `http://${AppConstants.localhost}`;

    export function webSocketAddress(port: number) {
        return `ws://${AppConstants.localhost}:${port}/ws`;
    }

    export const updateAssetsMessage = "updateAssetsMessage";
    export const showPreviewMessage = "showPreviewMessage";

    export const showPreviewToSideCommand = "axaml.showPreviewToSide";
    export const previewerAssetsCommand = "axaml.createPreviewerAssets";

    export const previewerPanelViewType = "axaml.Previewer";
    export const winExe = "WinExe";

    export const solutionData = "axaml.solutionData";
    export const solutionDiscoveryMeta = "axaml.solutionDiscoveryMeta";
    export const selectedExecutableProject = "axaml.selectedExecutableProject";

    export const updatePreviewerContent = "axaml.updatePreviewerContext";

    export const extensionId = "lextudio.vscode-axaml";

    export const newProjectCommandId = "axaml.newProject";
}

export default AppConstants;
