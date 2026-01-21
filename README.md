# Unloom

A browser-based screen recorder that saves directly to your local folder. No accounts, no cloud storage, no servers.

## Features

- Record screen with system audio and microphone
- Save recordings directly to a folder on your computer
- View and play recordings from a built-in library
- Delete recordings you no longer need
- Works entirely offline after initial load

## Browser Requirements

Unloom uses the File System Access API, which is only available in Chromium-based browsers:

- Google Chrome
- Microsoft Edge
- Brave

Firefox and Safari are not supported.

## How to Use

1. Open Unloom in a supported browser
2. Click "Select Folder" to choose where recordings will be saved
3. Click "Start Recording" and select what to share (screen, window, or tab)
4. Record your content
5. Click "Stop Recording" to save
6. Find your recordings in the library or directly in the folder you selected

### Permission Notes

- You'll be asked to grant screen sharing permission when starting a recording
- Microphone access is requested for voice recording
- Folder access needs to be re-granted each browser session (single click)

## Running Locally

Since this uses ES modules, you need to serve it via HTTP (not file://):

```bash
# Python 3
python -m http.server 8000

# Node.js (npx)
npx serve

# PHP
php -S localhost:8000
```

Then open http://localhost:8000

## Deploying to GitHub Pages

1. Create a new GitHub repository
2. Push this code to the main branch
3. Go to Settings > Pages
4. Select "Deploy from a branch" and choose "main" / root
5. Access at `https://<username>.github.io/<repo-name>`

## File Format

Recordings are saved as WebM files with VP9 video codec. These play in:

- Chrome, Firefox, Edge (native)
- VLC Media Player
- Most modern video players

## Privacy

- All data stays on your computer
- No analytics or tracking
- No network requests except for the initial page load
- Your recordings are never uploaded anywhere

## License

MIT
