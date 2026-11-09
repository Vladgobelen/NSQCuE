const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const { session, app } = require('electron');
const { setupSidecarLogging } = require('./utils');
const { getMainWindow } = require('./window');

const logger = setupSidecarLogging();

let sidecarProcess = null;

async function startSidecarAndProxy() {
    const binaryName = process.platform === 'win32' ? 'ts-sidecar.exe' : 'ts-sidecar-linux';
    const binaryPath = app.isPackaged
        ? path.join(process.resourcesPath, binaryName)
        : path.join(__dirname, '..', 'native', 'ts-sidecar', binaryName);

    console.log(`[SIDECAR DEBUG] binaryPath: ${binaryPath}`);
    console.log(`[SIDECAR DEBUG] exists: ${fs.existsSync(binaryPath)}`);

    if (!fs.existsSync(binaryPath)) {
        logger.error(`[SIDECAR] Binary not found at: ${binaryPath}`);
        return;
    }

    const authKey = 'tskey-auth-kdr1VQvKNr11CNTRL-5CvVLYoHh7VavdtcQTKM7Vv9JEPSgTmxc';

    logger.info('[SIDECAR] Starting process...');
    sidecarProcess = spawn(binaryPath, [], {
        env: { ...process.env, TS_AUTHKEY: authKey }
    });

    sidecarProcess.stdout.on('data', async (data) => {
        const text = data.toString().trim();
        logger.info(`[STDOUT] ${text}`);
        console.log(`[SIDECAR STDOUT] ${text}`);

        const match = text.match(/SOCKS_PORT=(\d+)/);
        if (match) {
            const port = match[1];
            logger.info(`[SIDECAR] Found SOCKS port: ${port}`);

            const nsSession = session.fromPartition('persist:ns');
            await nsSession.setProxy({
                proxyRules: `socks5://127.0.0.1:${port}`
            });
            logger.info('[SIDECAR] Proxy set for NSQCuE webview');
            console.log('[SIDECAR] Proxy applied. Waiting 1s before loading webview...');

            // Ждем 1 секунду, чтобы Electron точно был готов
            setTimeout(() => {
                const mainWindow = getMainWindow();
                if (mainWindow && !mainWindow.isDestroyed()) {
                    console.log('[SIDECAR] Sending load command to webview...');
                    mainWindow.webContents.executeJavaScript(`
                        const webview = document.getElementById('ns-webview');
                        if (webview) {
                            console.log('[WEBVIEW] Setting src to server...');
                            webview.src = 'https://100.126.188.12/?server=srv_68e645d6';
                        } else {
                            console.error('[WEBVIEW] Element not found!');
                        }
                    `).catch(err => {
                        logger.error('[SIDECAR] Failed to load webview:', err.message);
                        console.error('[SIDECAR] JS Error:', err.message);
                    });
                } else {
                    console.error('[SIDECAR] Main window is not available!');
                }
            }, 1000);
        }
    });

    sidecarProcess.stderr.on('data', (data) => {
        const text = data.toString().trim();
        logger.error(`[STDERR] ${text}`);
        console.log(`[SIDECAR STDERR] ${text}`);
    });

    sidecarProcess.on('close', (code) => {
        logger.info(`[SIDECAR] Process exited with code ${code}`);
        console.log(`[SIDECAR] Process exited with code ${code}`);
        sidecarProcess = null;
    });
}

function stopSidecar() {
    if (sidecarProcess) {
        logger.info('[SIDECAR] Stopping process...');
        sidecarProcess.kill();
        sidecarProcess = null;
    }
}

module.exports = { startSidecarAndProxy, stopSidecar };