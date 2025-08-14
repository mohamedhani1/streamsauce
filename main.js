const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

let mainWindow;
let isAuthenticated = false;
let appConfig = {
  title: 'StreamSauce',
  logo: null,
  darkMode: false,
  colors: {
    primary: '#ed254e',
    secondary: '#f9dc5c',
    background: '#f4fffd',
    dark: '#011936',
    gray: '#465362'
  }
};

// Decryption function
function decrypt(ciphertext, key) {
  try {
    const data = Buffer.from(ciphertext, 'base64');
    const keyBuffer = Buffer.from(key, 'utf8');

    const nonceSize = 12;
    const nonce = data.slice(0, nonceSize);
    const cipherData = data.slice(nonceSize, -16);
    const authTag = data.slice(-16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, nonce);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherData, null, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

// HTTP request helper
function makeHttpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const req = client.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'StreamSauce-App',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      devTools: false // Disable dev tools
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    show: false,
    frame: true,
    autoHideMenuBar: true, // Hide menu bar
    titleBarStyle: 'default'
  });

  mainWindow.loadFile('renderer/login.html');

  // Remove default menu
  mainWindow.setMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Disable dev tools completely
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
    }
    if (input.key === 'F12') {
      event.preventDefault();
    }
  });
}

// IPC Handlers
ipcMain.handle('validate-subscription', async (event, { subscriptionKey }) => {
  try {
    console.log('Validating subscription key...');

    if (!subscriptionKey || subscriptionKey.trim().length === 0) {
      return { success: false, message: 'Please enter a valid subscription key' };
    }

    // Validate subscription using the proper endpoint
    const response = await makeHttpRequest(`http://127.0.0.1:65000/api/public/validate/${subscriptionKey}`);

    if (response.status !== 200) {
      return { success: false, message: 'Failed to validate subscription key' };
    }

    // Decrypt the validation response
    const decryptionKey = 'EvMimti9L6yB7As37tH2VdjzLoBxYHts';
    const decryptedData = decrypt(response.data.data, decryptionKey);
    const validationResult = JSON.parse(decryptedData);

    console.log('Validation result:', validationResult);

    if (!validationResult.valid) {
      let errorMessage = 'Invalid subscription key';

      if (validationResult.status === 'expired') {
        errorMessage = 'Your subscription has expired';
      } else if (validationResult.status === 'not_started') {
        errorMessage = 'Your subscription has not started yet';
      } else if (validationResult.error) {
        errorMessage = validationResult.error;
      }

      return { success: false, message: errorMessage };
    }

    // Subscription is valid, now handle branding
    let updatedAppConfig = { ...appConfig };

    if (validationResult.user && validationResult.user.is_hoster && validationResult.user.iptv_hoster) {
      // User is an IPTV hoster, apply their custom branding
      const hosterInfo = validationResult.user.iptv_hoster;

      console.log('Applying IPTV hoster branding:', hosterInfo.name);

      // Update app title and logo
      updatedAppConfig.title = hosterInfo.name;
      updatedAppConfig.logo = hosterInfo.logo;

      // Parse and apply color palette
      try {
        const colorPalette = JSON.parse(hosterInfo.color_palette);
        if (Array.isArray(colorPalette) && colorPalette.length >= 3) {
          updatedAppConfig.colors = {
            primary: colorPalette[0] || appConfig.colors.primary,
            secondary: colorPalette[1] || appConfig.colors.secondary,
            background: colorPalette[2] || appConfig.colors.background,
            dark: colorPalette[3] || appConfig.colors.dark,
            gray: colorPalette[4] || appConfig.colors.gray
          };
        }
      } catch (colorError) {
        console.error('Error parsing color palette:', colorError);
        // Keep default colors if parsing fails
      }

      // Update global app config
      appConfig = updatedAppConfig;
      mainWindow.setTitle(appConfig.title);

      console.log('Applied custom branding for:', hosterInfo.name);
    } else {
      // Regular user, use default StreamSauce branding
      console.log('Using default StreamSauce branding');
      mainWindow.setTitle(appConfig.title);
    }

    // Store subscription info
    global.currentSubscription = validationResult.subscription;
    global.currentUser = validationResult.user;
    isAuthenticated = true;

    return {
      success: true,
      user: validationResult.user,
      subscription: validationResult.subscription,
      appConfig: appConfig
    };

  } catch (error) {
    console.error('Subscription validation error:', error);
    return { success: false, message: 'Failed to validate subscription. Please check your connection.' };
  }
});

ipcMain.handle('get-packages', async () => {
  if (!isAuthenticated) {
    return { success: false, message: 'Not authenticated' };
  }

  try {
    const response = await makeHttpRequest('http://127.0.0.1:65000/api/public/packages');

    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }

    const decryptionKey = 'EvMimti9L6yB7As37tH2VdjzLoBxYHts';
    const decryptedData = decrypt(response.data.data, decryptionKey);
    const packages = JSON.parse(decryptedData);
    console.log(packages.channels);
    return { success: true, packages };
  } catch (error) {
    console.error('Error getting packages:', error);
    return { success: false, packages: [] };
  }
});

ipcMain.handle('toggle-dark-mode', async () => {
  appConfig.darkMode = !appConfig.darkMode;
  return { success: true, darkMode: appConfig.darkMode };
});

ipcMain.handle('get-app-config', async () => {
  return appConfig;
});

ipcMain.handle('logout', async () => {
  isAuthenticated = false;
  // Reset to default config
  appConfig = {
    title: 'StreamSauce',
    logo: null,
    darkMode: false,
    colors: {
      primary: '#ed254e',
      secondary: '#f9dc5c',
      background: '#f4fffd',
      dark: '#011936',
      gray: '#465362'
    }
  };
  mainWindow.setTitle(appConfig.title);
  return { success: true };
});

// App event handlers
app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Disable certificate errors for development
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (process.env.NODE_ENV === 'development') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

console.log('StreamSauce started');
