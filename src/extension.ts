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

const RE_MEDIA = /((\S+\.(flac|mp3|wav|mp4|m4a|mkv|wma|aac|mov))(\{([\d.:,]+)\})?|https?:\/\/\S+)/;

let playerRunning = false;

async function findAndPlayMediaUrl() {
    const configuration = vscode.workspace.getConfiguration();
    const playMediaCmdPattern: string = vscode.workspace.getConfiguration().get('playMediaUrl.playMediaCmdPattern') || '';
    if (playerRunning && playMediaCmdPattern.startsWith('ffplay')) {
        await execShell('taskkill /f /t /im ffplay.exe');
    }
    const mediaFolders: readonly string[] = configuration.get('playMediaUrl.localMediaFolders') || [];
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const mediaUrlInfo = getMediaUrlAtCurrentCursor(editor);
        if (!mediaUrlInfo.text) {
            return;
        }
        if (mediaUrlInfo.text.startsWith('https://') || mediaUrlInfo.text.startsWith('http://')) {
            await playMediaUrl(mediaUrlInfo.text, {});
            return;
        }
        const params = buildCmdParams(mediaUrlInfo.text, mediaUrlInfo.selectionStart, mediaUrlInfo.selectionEnd);
        for (const mediaFolder of mediaFolders) {
            const folderUri = parseUri(mediaFolder);
            const mediaUri = vscode.Uri.joinPath(folderUri, params.fileName);
            try {
                await vscode.workspace.fs.stat(mediaUri);
            }
            catch (error) {
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

function buildCmdParams(rawName: string, selectionStart: number, selectionEnd: number): {fileName: string, ffplaySs?: string, ffplayT?: string} {
    const match = rawName.match(RE_MEDIA);
    if (match && match[5]) {
        const reSS = /(\d+:)?(\d+:)?(\d+)(\.(\d{1,3}))?/g;
        let indexStart = -1;
        let indexEnd = -1;
        let ssMatch;
        const ssList = [];
        const millisList = [];
        while (ssMatch = reSS.exec(match[5])) {
            if (selectionStart - match[2].length - 1 - (match.index || 0) >= ssMatch.index && selectionStart - match[2].length - 1 - (match.index || 0) <= ssMatch.index + ssMatch[0].length) {
                indexStart = ssList.length;
            }
            if (selectionEnd - match[2].length - 1 - (match.index || 0) >= ssMatch.index && selectionEnd - match[2].length - 1 - (match.index || 0) <= ssMatch.index + ssMatch[0].length) {
                indexEnd = ssList.length;
            }
            ssList.push(ssMatch[0]);
            const millis = ((parseInt(ssMatch[1] || '0') * 60 + parseInt(ssMatch[2] || '0')) * 60 + parseInt(ssMatch[3] || '0')) * 1000 + parseInt((ssMatch[5] || '').padEnd(3, '0'));
            millisList.push(millis);
        }
        if (indexStart === -1 || indexEnd === -1) {
            indexStart = 0;
            indexEnd = millisList.length - 1;
        }
        else {
            if (indexEnd < millisList.length - 1) {
                indexEnd++;
            }
            if (indexStart >= indexEnd) {
                if (indexStart < millisList.length - 1) {
                    indexEnd = indexStart + 1;
                }
                else if (indexEnd === millisList.length - 1 && indexEnd > 0) {
                    indexStart = indexEnd - 1;
                }
                else {
                    indexStart = 0;
                    indexEnd = millisList.length - 1;
                }
            }
        }
        const fromMillis = millisList[indexStart];
        const toMillis = millisList[indexEnd];
        const durationMillis = toMillis - fromMillis;
        return {
            fileName: match[2],
            ffplaySs: `-ss ${ssList[indexStart]}`,
            ffplayT: durationMillis > 0 ? `-t ${(durationMillis / 1000).toFixed(3)}` : '',
        };
    }
    return { fileName: rawName };
}

async function playMediaUrl(fileOrUrl: string, params: {fileName?: string, ffplaySs?: string, ffplayT?: string}) {
    const playMediaCmdPattern: string = vscode.workspace.getConfiguration().get('playMediaUrl.playMediaCmdPattern') || '';
    if (!playMediaCmdPattern) {
        return;
    }
    const cmd = playMediaCmdPattern
        .replace("${url}", `"${fileOrUrl}"`)
        .replace('${ffplay-ss}', params.ffplaySs || '')
        .replace('${ffplay-t}', params.ffplayT || '');
    try {
        await execShell(cmd);
    }
    catch (error) {
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

function getMediaUrlAtCurrentCursor(editor: vscode.TextEditor): {text: string, selectionStart: number, selectionEnd: number} {
	const document = editor.document;
    const start = editor.selection.start.character;
    const end = editor.selection.end.character;
    const wordUnderCursorRange = document.getWordRangeAtPosition(editor.selection.active, /\S+/);
    const currentWord = document.getText(wordUnderCursorRange).trim();
    const lineNumber = editor.selection.active.line;
    const allInSameLine = editor.selection.start.line === lineNumber && editor.selection.end.line === lineNumber && (!wordUnderCursorRange || wordUnderCursorRange.start.line === editor.selection.start.line);
    if (allInSameLine && currentWord.length < 500) {
        const match = currentWord.match(RE_MEDIA);
        if (match) {
            const offset = wordUnderCursorRange?.start.character || 0;
            const selectionStart = allInSameLine ? start - offset - (match.index || 0) : 0;
            const selectionEnd = allInSameLine ? end - offset - (match.index || 0) : 0;
            return { text: match[1], selectionStart, selectionEnd };
        }
    }
    const line = document.lineAt(lineNumber);
    const match = line.text.match(RE_MEDIA);
    if (match) {
        const selectionStart = allInSameLine ? start - (match.index || 0) : 0;
        const selectionEnd = allInSameLine ? end - (match.index || 0) : 0;
        return { text: match[1], selectionStart, selectionEnd };
    }
    return { text: '', selectionStart: 0, selectionEnd: 0 };
}
