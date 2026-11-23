import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverHandle = null;

// Garante apenas uma instância aberta do aplicativo (evita concorrência no SQLite)
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function resolveResourcesPaths() {
  if (app.isPackaged) {
    return {
      staticDir: path.join(process.resourcesPath, 'frontend'),
      migrationsDir: path.join(process.resourcesPath, 'migrations'),
    };
  }
  return {
    staticDir: path.join(__dirname, 'app', 'frontend'),
    migrationsDir: path.join(__dirname, 'app', 'backend', 'migrations'),
  };
}

async function createMainWindow(url) {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'MyMoney — Gestão Financeira Pessoal',
    backgroundColor: '#f8fafc',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Links externos abrem no navegador padrão do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      void shell.openExternal(targetUrl);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    const userDataDir = app.getPath('userData');
    fs.mkdirSync(userDataDir, { recursive: true });

    // Define o caminho do banco ANTES de importar o backend
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'warn';
    process.env.DATABASE_PATH = path.join(userDataDir, 'finance.db');

    const { staticDir, migrationsDir } = resolveResourcesPaths();
    const { startDesktopServer } = await import('./app/backend/dist/desktop-entry.js');

    serverHandle = await startDesktopServer({
      staticDir,
      migrationsDir,
      host: '127.0.0.1',
      port: 0,
    });

    await createMainWindow(serverHandle.url);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    dialog.showErrorBox(
      'Erro ao iniciar o MyMoney',
      `Não foi possível inicializar o aplicativo.\n\nDetalhes:\n${message}`,
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (serverHandle) {
    const handle = serverHandle;
    serverHandle = null;
    try {
      await handle.stop();
    } catch {
      // Ignora erro ao encerrar
    }
  }
});
