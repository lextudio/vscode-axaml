import * as vscode from "vscode";
import { Command } from "../commandManager";
import * as child_process from "child_process";
import * as net from "net";
import * as path from "path";
import * as util from "../util/Utilities";
import { getSolutionModel } from "../services/solutionParser";
import * as fs from "fs-extra";

export class OpenDesignerCommand implements Command {
    public readonly id = "axaml.openDesigner";
    constructor(private context: vscode.ExtensionContext) {}

    private output = vscode.window.createOutputChannel('AXAML Designer');

    public async execute(...args: any[]): Promise<any> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("No active editor to open in designer.");
            return;
        }
        const doc = editor.document;
        if (doc.languageId !== "axaml") {
            vscode.window.showWarningMessage("Active file is not an AXAML file.");
            return;
        }

        // Locate bundled MyDesigner executable under extension's designerServer folder
        const serverDir = path.join(this.context.extensionPath, "designerServer");
        const dllName = "MyDesigner.XamlDesigner.dll";
        const dllPath = path.join(serverDir, dllName);

        this.output.appendLine(`[OpenDesigner] Extension path: ${this.context.extensionPath}`);
        this.output.appendLine(`[OpenDesigner] Server dir: ${serverDir}`);
        this.output.appendLine(`[OpenDesigner] DLL path: ${dllPath}`);

        // Check if DLL exists
        const dllExists = await fs.pathExists(dllPath);
        this.output.appendLine(`[OpenDesigner] DLL exists: ${dllExists}`);
        if (!dllExists) {
            this.output.appendLine(`[OpenDesigner] Available files in ${serverDir}:`);
            try {
                if (await fs.pathExists(serverDir)) {
                    const files = await fs.readdir(serverDir);
                    for (const file of files) {
                        this.output.appendLine(`  - ${file}`);
                    }
                } else {
                    this.output.appendLine(`  (directory does not exist)`);
                }
            } catch (err) {
                this.output.appendLine(`  (error reading directory: ${err})`);
            }
        }

        try {
            // attempt spawn
            const port = 50023;
            // spawn using dotnet for framework-dependent deployment
            this.output.appendLine(`[OpenDesigner] Spawning: dotnet ${dllPath} --serve --port ${port}`);
            const proc = child_process.spawn("dotnet", [dllPath, "--serve", "--port", port.toString()], {
                detached: true,
                stdio: "pipe",
            });

            // Capture stderr to log errors
            proc.stderr?.on('data', (data) => {
                this.output.appendLine(`[DesignerHost stderr] ${data.toString()}`);
            });

            proc.unref();

            // Wait shortly and connect via TCP
            await new Promise((r) => setTimeout(r, 500));
            let info = this.getAssemblyInfoFromSolution(doc.uri.fsPath);
            if (!info || !info.assemblyPaths || info.assemblyPaths.length === 0) {
                const choice = await vscode.window.showInformationMessage(
                    "Project build outputs not found. Build project and generate previewer assets now?",
                    "Yes",
                    "No"
                );
                if (choice === "Yes") {
                    await vscode.commands.executeCommand('axaml.createPreviewerAssets', { triggerCodeComplete: false });
                    // wait a moment for asset generation to update workspace state
                    await new Promise((r) => setTimeout(r, 500));
                    info = this.getAssemblyInfoFromSolution(doc.uri.fsPath);
                }
            }
            await this.sendStartSession(port, doc.uri.fsPath, info);
            vscode.window.showInformationMessage("Designer started and file sent.");
        } catch (e) {
            this.output.appendLine(`[OpenDesigner] Error in first attempt: ${e}`);
            try {
                // fallback: try spawn by name
                const port = 50023;
                this.output.appendLine(`[OpenDesigner] Fallback: Spawning dotnet MyDesigner.XamlDesigner.dll --serve --port ${port}`);
                const proc = child_process.spawn("dotnet", ["MyDesigner.XamlDesigner.dll", "--serve", "--port", port.toString()], {
                    detached: true,
                    stdio: "pipe",
                });

                // Capture stderr to log errors
                proc.stderr?.on('data', (data) => {
                    this.output.appendLine(`[DesignerHost stderr] ${data.toString()}`);
                });

                proc.unref();
                await new Promise((r) => setTimeout(r, 500));
                let info = this.getAssemblyInfoFromSolution(doc.uri.fsPath);
                if (!info || !info.assemblyPaths || info.assemblyPaths.length === 0) {
                    const choice = await vscode.window.showInformationMessage(
                        "Project build outputs not found. Build project and generate previewer assets now?",
                        "Yes",
                        "No"
                    );
                    if (choice === "Yes") {
                        await vscode.commands.executeCommand('axaml.createPreviewerAssets', { triggerCodeComplete: false });
                        await new Promise((r) => setTimeout(r, 500));
                        info = this.getAssemblyInfoFromSolution(doc.uri.fsPath);
                    }
                }
                await this.sendStartSession(port, doc.uri.fsPath, info);
                vscode.window.showInformationMessage("Designer started and file sent.");
            } catch (ex) {
                this.output.appendLine(`[OpenDesigner] Error in fallback attempt: ${ex}`);
                this.output.show(true);
                vscode.window.showErrorMessage("Failed to start MyDesigner host. Check AXAML Designer output for details.");
            }
        }
    }

    private sendStartSession(port: number, filePath: string, info?: { assemblyPaths?: string[]; projectAssemblyName?: string }): Promise<void> {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            let buffer = '';
            let resolved = false;

            client.connect(port, "127.0.0.1", () => {
                const payload: any = { type: "startSession", filePath };
                if (info?.assemblyPaths) payload.assemblyPaths = info.assemblyPaths;
                if (info?.projectAssemblyName) payload.projectAssemblyName = info.projectAssemblyName;
                const msg = JSON.stringify(payload) + "\n";
                client.write(msg);
            });

            client.on("data", (data) => {
                buffer += data.toString("utf8");
                // Process all complete lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';  // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line) continue;
                    try {
                        const doc = JSON.parse(line);
                        
                        // Handle log messages
                        if (doc.type === "log") {
                            const logLine = `[${doc.level?.toUpperCase() || 'INFO'}] ${doc.message || ''}`;
                            this.output.appendLine(logLine);
                            continue;
                        }
                        
                        // Handle sessionStarted response
                        if (doc.type === "sessionStarted") {
                            if (doc.warnings && Array.isArray(doc.warnings) && doc.warnings.length) {
                                this.output.appendLine('Designer start warnings:');
                                for (const w of doc.warnings) this.output.appendLine('  - ' + w);
                            }
                            this.output.show(true);
                            if (!resolved) {
                                resolved = true;
                                setTimeout(() => client.destroy(), 500);  // Delay destroy to allow final logs
                                resolve();
                            }
                            return;
                        }
                    } catch (e) {
                        // Ignore JSON parse errors
                    }
                }
            });

            client.on("error", (err) => {
                this.output.appendLine(`[ERROR] Connection error: ${err.message}`);
                this.output.show(true);
                if (!resolved) {
                    resolved = true;
                    reject(err);
                }
            });

            client.on("close", () => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            });

            // Timeout after 5 seconds
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.output.appendLine('[WARN] Connection timeout (no response from designer server)');
                    this.output.show(true);
                    client.destroy();
                    resolve();
                }
            }, 5000);
        });
    }

    private getAssemblyInfoFromSolution(filePath: string): { assemblyPaths?: string[]; projectAssemblyName?: string } | undefined {
        try {
            const fileData = util.getFileDetails(filePath, this.context);
            if (!fileData) return undefined;
            const solution = getSolutionModel(this.context);
            if (!solution) return undefined;

            // gather the main assembly for the file (usually fileData.targetPath)
            const assemblyPaths: string[] = [];
            if (fileData.targetPath) assemblyPaths.push(fileData.targetPath);

            // find the project and include referenced project outputs if available
            const proj = solution.projects.find((p) => p.path === fileData.projectPath);
            const projectAssemblyName = proj?.name;
            if (proj) {
                if (proj.targetPath && !assemblyPaths.includes(proj.targetPath)) assemblyPaths.push(proj.targetPath);
                if (proj.projectReferences && proj.projectReferences.length) {
                    for (const ref of proj.projectReferences) {
                        const rp = solution.projects.find((p) => p.path === ref);
                        if (rp && rp.targetPath && !assemblyPaths.includes(rp.targetPath)) assemblyPaths.push(rp.targetPath);
                    }
                }
            }

            return { assemblyPaths: assemblyPaths.length ? assemblyPaths : undefined, projectAssemblyName };
        } catch (e) {
            return undefined;
        }
    }
}
