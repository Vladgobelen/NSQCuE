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

    // Отладка: проверяем, видит ли Electron бинарник
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
            console.log('[SIDECAR] Proxy applied. Reloading webview...');

            // ПРИНУДИТЕЛЬНО ПЕРЕЗАГРУЖАЕМ WEBVIEW, ЧТОБЫ ОН ЗАГРУЗИЛСЯ ЧЕРЕЗ ПРОКСИ
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.executeJavaScript(`
                    const webview = document.getElementById('ns-webview');
                    if (webview) {
                        webview.reload();
                        console.log('[WEBVIEW] Reloaded via sidecar proxy');
                    }
                `).catch(err => {
                    logger.error('[SIDECAR] Failed to reload webview:', err.message);
                });
            }
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