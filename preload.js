const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    validateSubscription: (subscriptionKey) => {
        return ipcRenderer.invoke('validate-subscription', { subscriptionKey });
    },

    getPackages: () => {
        return ipcRenderer.invoke('get-packages');
    },

    getAppConfig: () => {
        return ipcRenderer.invoke('get-app-config');
    },

    toggleDarkMode: () => {
        return ipcRenderer.invoke('toggle-dark-mode');
    },

    logout: () => {
        return ipcRenderer.invoke('logout');
    }
});
