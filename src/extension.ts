import * as vscode from 'vscode';
import * as cp from 'child_process';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('play-media-url.playMedia', findAndPlayMediaUrl);
	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}

const RE_MEDIA = /((\S+\.(mp3|wav|mp4|mkv))(\{([\d.:]+),([\d.:]+)\})?|https?:\/\/\S+)/;
const RE_SS = /(\d+:)?(\d+:)?(\d+)(\.(\d{1,3}))?/;

let playerRunning = false;

async function findAndPlayMediaUrl() {
	const configuration = vscode.workspace.getConfiguration();
	const playMediaCmdPattern: string = vscode.workspace.getConfiguration().get('playMediaUrl.playMediaCmdPattern') || '';
	if (playerRunning && playMediaCmdPattern.startsWith('ffplay')) {
		await execShell('taskkill /f /t /im ffplay.exe');
	}
	const mediaFolders: string[] = configuration.get('playMediaUrl.localMediaFolders') || [];
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const mediaUrl = getMediaUrlAtCurrentCursor(editor);
		if (!mediaUrl) {
			return;
		}
		if (mediaUrl.startsWith('https://') || mediaUrl.startsWith('http://')) {
			await playMediaUrl(mediaUrl, {});
			return;
		}
		const params = buildFileName(mediaUrl);
		for (const mediaFolder of mediaFolders) {
			const folderUri = parseUri(mediaFolder);
			const mediaUri = vscode.Uri.joinPath(folderUri, params.fileName);
			try {
				await vscode.workspace.fs.stat(mediaUri);
			} catch (error) {
				continue;
			}
			playerRunning = true;
			await playMediaUrl(mediaUri.fsPath, params);
			playerRunning = false;
			return;
		}
		vscode.window.showErrorMessage(`File not found: ${params.fileName}`);
	}
}

function buildFileName(rawName: string) {
	const match = rawName.match(RE_MEDIA);
	if (match && match[5] && match[6]) {
		const fromMillis = ssToMillis(match[5]);
		const toMillis = ssToMillis(match[6]);
		const durationMillis = toMillis - fromMillis;
		return {
			fileName: match[2],
			'ffplay-ss': `-ss ${match[5]}`,
			'ffplay-t': durationMillis > 0 ? `-t ${(durationMillis / 1000).toFixed(3)}` : '',
		};
	}
	return {fileName: rawName};
}

/** Converts time format [hh:mm:ss.zzz] to milliseconds. */
function ssToMillis(ss: string) {
	const match = ss.match(RE_SS);
	if (match) {
		return ((parseInt(match[1] || '0') * 60 + parseInt(match[2] || '0')) * 60 + parseInt(match[3] || '0')) * 1000 + parseInt((match[5] || '').padEnd(3, '0'));
	}
	return 0;
}

async function playMediaUrl(fileOrUrl: string, params: any) {
	const playMediaCmdPattern: string = vscode.workspace.getConfiguration().get('playMediaUrl.playMediaCmdPattern') || '';
	if (!playMediaCmdPattern) {
		return;
	}
	const cmd = playMediaCmdPattern
		.replace("${url}", `"${fileOrUrl}"`)
		.replace('${ffplay-ss}', params['ffplay-ss'] || '')
		.replace('${ffplay-t}', params['ffplay-t'] || '');
	try {
		await execShell(cmd);
	} catch (error) {
		vscode.window.showErrorMessage(`${error}`);
	}
}

async function execShell(cmd: string): Promise<any> {
	return await new Promise((resolve, reject) => {
		cp.exec(cmd, (err, out) => {
			if (err) {
				console.error(err);
			}
			resolve(1);
		});
	});
}

function parseUri(path: string): vscode.Uri {
	try {
		return vscode.Uri.file(path);
	} catch (error) {
		return vscode.Uri.parse(path);
	}
}

function getMediaUrlAtCurrentCursor(editor: vscode.TextEditor): string {
	const document = editor.document;
	const wordUnderCursorRange = document.getWordRangeAtPosition(editor.selection.active, /\S+/);
	const currentWord = document.getText(wordUnderCursorRange).trim();
	if (currentWord.match(RE_MEDIA)) {
		return currentWord;
	}
	const lineNumber = editor.selection.active.line;
	const line = document.lineAt(lineNumber);
	const match = line.text.match(RE_MEDIA);
	if (match) {
		return match[1];
	}
	return '';
}
