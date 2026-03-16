import { PreviewerProcess } from "./commands/previewerProcess";
import * as vscode from "vscode";
import { PreviewerData } from "./models/previewerSettings";
const kill = require("tree-kill");

/**
 * Manages preview processes for files.
 */
export class PreviewProcessManager {
  // Map to store the preview processes for each file
  private readonly _processes = new Map<string, PreviewerData>();

  /**
   * Adds a new preview process for a file.
   * @param file The file to add the preview process for.
   * @param previewerData The preview process data.
   */
  public addProcess(file: string, previewerData: PreviewerData) {
    this._processes.set(file, previewerData);
  }

  /**
   * Gets the preview process data for a file.
   * @param file The file to get the preview process data for.
   * @returns The preview process data for the file, or undefined if no preview process is found.
   */
  public getPreviewerData(file: string): PreviewerData | undefined {
    return this._processes.get(file);
  }

  /**
   * Ends the preview process for a file.
   * @param file The file to end the preview process for.
   */
  public endProcess(file: string) {
    const { pid } = this._processes.get(file) ?? {};
    if (pid) {
      kill(pid, "SIGKILL", (err: any) => {
        if (err) {
          console.error(err);
        }
      });
      this._processes.delete(file);
    }
  }

  /**
   * Removes a process entry from the map without sending a kill signal.
   * Use this when the process has already exited on its own (e.g. crash).
   * @param file The map key used when the process was added.
   */
  public removeProcess(file: string) {
    this._processes.delete(file);
  }

  /**
   * Ends all preview processes.
   */
  public killPreviewProcess() {
    this._processes.forEach((value, key) => {
      this.endProcess(key);
    });
  }
}
