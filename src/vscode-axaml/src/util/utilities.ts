import path = require("path");
import * as vscode from "vscode";
import * as sm from "../models/solutionModel";
import { getSolutionModel } from "../services/solutionParser";
import AppConstants from "./constants";

// TODO:move const strings to Constants
export const avaloniaFileExtension = "axaml";
export const avaloniaLanguageId = "axaml";
export const logger = vscode.window.createOutputChannel("AXAML Client", { log: true });

// Known conflicting / legacy AXAML extensions
export const conflictingExtensions = [
	"AvaloniaTeam.vscode-avalonia",
	"microhobby.vscode-avalonia-community",
	"xamltocsharpgenerator.axsg-language-server",
];

export function hasConflictingExtensions(): boolean {
	return (
		conflictingExtensions
			.map((id) => vscode.extensions.getExtension(id))
			.filter((ext) => !!ext).length > 0
	);
}

/**
 * Checks if the given document is an Avalonia file.
 * @param document vscode TextDocument
 * @returns `true` if it's an Avalonia file, `false` otherwise
 */
const axamlLang = AppConstants.contributions.languages.find((v: any) => v.id.toLowerCase() === avaloniaLanguageId);
export function isAvaloniaFile(document: vscode.TextDocument): boolean {
	// axamlLang will never be null | undefined!
	if (!axamlLang) {
		throw new Error("Variable 'axamlLang' remained undefined after the extension loaded!");
	}
	return axamlLang.extensions.some((dotExt: any) => path.extname(document.fileName) === dotExt);
}

/**
 * Checks if the given document is an Avalonia file.
 * @param filePath file path
 * @returns filename
 */
export function getFileName(filePath: string): string {
	return path.basename(filePath);
}

/**
 * Returns all executable projects from solution model
 */
export function getExecutableProjects(solution: sm.Solution): sm.Project[] {
	return solution.projects.filter(
		(p) => {
			const type = (p.normalizedOutputType || p.outputType || "").toString();
			return /^(?:Win)?Exe$/i.test(type);
		}
	);
}

/**
 * Returns the file details from solution model
 * @param file file path
 * @param context vscode extension context
 * @returns File details from solution model
 */
export function getFileDetails(file: string, context: vscode.ExtensionContext): sm.File | undefined {
	const solution = getSolutionModel(context);
	const fileData = solution?.files.find((f) => f.path === file);
	return fileData;
}

declare global {
	interface Array<T> {
		getValue(property: string): string;
	}

	interface String {
		putInQuotes(): string;
	}
}
Array.prototype.getValue = function (this: string[], property: string): string {
	const value = this.find((line) => line.includes(property));
	return value ? value.split("=")[1].trim() : "";
};

String.prototype.putInQuotes = function (this: string): string {
	return `"${this}"`;
};
