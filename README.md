# Unthumb

A Chrome extension that replaces YouTube homepage thumbnails with an actual frame from the video, so you see what's in the video instead of a clickbait thumbnail.

It works by extracting still frames from YouTube's storyboard sprite sheets — the same frames you see when hovering over the progress bar.

## Install

Unthumb isn't on the Chrome Web Store yet, so you'll need to install it manually as an unpacked extension.

1. **Download the extension** — Clone or download this repository to a folder on your computer.

2. **Open Chrome's extension page** — Navigate to `chrome://extensions` in your address bar.

3. **Enable Developer Mode** — Toggle the **Developer mode** switch in the top-right corner of the page.

4. **Load the extension** — Click **Load unpacked** in the top-left and select the folder containing this repository.

5. **Visit YouTube** — Open (or refresh) [youtube.com](https://www.youtube.com). Thumbnails on the homepage will be replaced with video frames.

## Options

Click the Unthumb icon in your Chrome toolbar to configure:

- **Frame position** — Choose what point in the video to grab (default: 30%).
- **Random position** — Pick a random frame for each video instead of a fixed percentage.
- **Fallback behavior** — When a storyboard isn't available, show the original thumbnail or a black box.

## How it works

When you load the YouTube homepage, the extension:

1. Finds thumbnail elements on the page
2. Asks the background service worker to fetch the video's storyboard data
3. Picks the frame at your chosen position from the highest-resolution storyboard layer
4. Displays that frame as a CSS background on an overlay, replacing the original thumbnail

YouTube is a single-page app, so the extension also watches for page navigations and dynamically added thumbnails via MutationObserver.

## Support

[Support on Ko-fi](https://ko-fi.com/philcunliffe)
