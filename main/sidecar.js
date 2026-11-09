const { spawn } = require('child_process');
const path = require('path');
const { session, app } = require('electron');
const { setupSidecarLogging } = require('./utils');

const logger = setupSidecarLogging();

let sidecarProcess = null;

async function startSidecarAndProxy() {
    const binaryName = process.platform === 'win32' ? 'ts-sidecar.exe' : 'ts-sidecar-linux';
    const binaryPath = app.isPackaged
        ? path.join(process.resourcesPath, binaryName)
        : path.join(__dirname, '..', 'native', 'ts-sidecar', binaryName);

    const authKey = 'tskey-auth-kdr1VQvKNr11CNTRL-5CvVLYoHh7VavdtcQTKM7Vv9JEPSgTmxc';

    logger.info('[SIDECAR] Starting process...');
    sidecarProcess = spawn(binaryPath, [], {
        env: { ...process.env, TS_AUTHKEY: authKey }
    });

    sidecarProcess.stdout.on('data', async (data) => {
        const text = data.toString().trim();
        logger.info(`[STDOUT] ${text}`);

        const match = text.match(/SOCKS_PORT=(\d+)/);
        if (match) {
            const port = match[1];
            logger.info(`[SIDECAR] Found SOCKS port: ${port}`);

            const nsSession = session.fromPartition('persist:ns');
            await nsSession.setProxy({
                proxyRules: `socks5://127.0.0.1:${port}`
            });
            logger.info('[SIDECAR] Proxy set for NSQCuE webview');
        }
    });

    sidecarProcess.stderr.on('data', (data) => {
        logger.error(`[STDERR] ${data.toString().trim()}`);
    });

    sidecarProcess.on('close', (code) => {
        logger.info(`[SIDECAR] Process exited with code ${code}`);
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