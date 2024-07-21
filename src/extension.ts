import * as cp from 'child_process';
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('play-media-url.playMedia', findAndPlayMediaUrl);
    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}

const RE_WIN_FULL_PATH_START = /^[a-zA-Z]:/;

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
        const workspaceFolderUri = vscode.workspace.workspaceFolders?.[0]?.uri || parseUri('');
        for (const mediaFolder of mediaFolders) {
            const isAbsolutePath = mediaFolder.startsWith('/') || mediaFolder.match(RE_WIN_FULL_PATH_START);
            const mediaUri = isAbsolutePath
                ? vscode.Uri.joinPath(parseUri(mediaFolder), params.fileName)
                : vscode.Uri.joinPath(workspaceFolderUri, mediaFolder, params.fileName);
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
    const RE_MEDIA = /((\S+\.(flac|mp3|wav|mp4|m4a|mkv|wma|aac|mov)(?!")|"[^"]+\.(flac|mp3|wav|mp4|m4a|mkv|wma|aac|mov)")(\{([\d.:,]+)\})?|https?:\/\/\S+)/;
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
        let fileName = match[2];
        if (fileName.startsWith('"') && fileName.endsWith('"')) {
            fileName = fileName.substring(1, fileName.length - 1);
        }
        return {
            fileName,
            ffplaySs: `-ss ${ssList[indexStart]}`,
            ffplayT: durationMillis > 0 ? `-t ${(durationMillis / 1000).toFixed(3)}` : '',
        };
    }
    return { fileName: rawName.startsWith('"') && rawName.endsWith('"') ? rawName.substring(1, rawName.length - 1) : rawName };
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
    const RE_MEDIA = /((\S+\.(flac|mp3|wav|mp4|m4a|mkv|wma|aac|mov)(?!")|"[^"]+\.(flac|mp3|wav|mp4|m4a|mkv|wma|aac|mov)")(\{([\d.:,]+)\})?|https?:\/\/\S+)/g;
    if (editor.selection.start.line === editor.selection.end.line) {
        const line = editor.document.lineAt(editor.selection.active.line).text;
        while (true) {
            const match = RE_MEDIA.exec(line);
            if (!match) {
                break;
            }
            if ((match.index <= editor.selection.start.character && match.index + match[0].length > editor.selection.start.character) ||
                    (match.index <= editor.selection.end.character && match.index + match[0].length > editor.selection.end.character)) {
                const selectionStart = editor.selection.start.character - (match.index || 0);
                const selectionEnd = editor.selection.end.character - (match.index || 0);
                return { text: match[1], selectionStart, selectionEnd };
            }
        }    
    }
    return {text: '', selectionStart: 0, selectionEnd: 0};
}
