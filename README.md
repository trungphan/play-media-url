# play-media-url

VS Code extension to look for media URL under the cursor or in the current line and use the media player of your choice to play the media. If the media URL is a file path, it will try to find the media file in provided media folders.

## Features

Execute command `Play Media URL` to play the media URL under the cursor or in the current line.

## Requirements

By default, `play-media-url` will use `ffplay` to play the media, so either install `ffplay` and place it in the path, or configure the setting `playMediaUrl.playMediaCmdPattern` to define the command to play the media.

## Extension Settings

This extension contributes the following settings:

* `playMediaUrl.localMediaFolders`: list of local media folders to find the media file.
* `playMediaUrl.playMediaCmdPattern`: command pattern to execute to play a media url. Default: `ffplay -autoexit -nodisp ${url}`.

## Release Notes

### 1.0.0

Initial release of play-media-url
