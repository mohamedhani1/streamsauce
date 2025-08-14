document.addEventListener('DOMContentLoaded', async () => {
    const loginForm = document.getElementById('loginForm');
    const subscriptionKeyInput = document.getElementById('subscriptionKey');
    const loginBtn = document.getElementById('loginBtn');
    const btnText = loginBtn.querySelector('.btn-text');
    const spinner = loginBtn.querySelector('.spinner');
    const errorMessage = document.getElementById('errorMessage');
    const appTitle = document.getElementById('appTitle');

    // Load app config and update UI
    try {
        const config = await window.electronAPI.getAppConfig();
        if (config) {
            applyBranding(config);
        }
    } catch (error) {
        console.error('Failed to load app config:', error);
    }

    subscriptionKeyInput.focus();

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleLogin();
    });

    async function handleLogin() {
        const subscriptionKey = subscriptionKeyInput.value.trim();

        if (!subscriptionKey) {
            showError('Please enter your subscription key.');
            return;
        }

        setLoadingState(true);
        hideError();

        try {
            const result = await window.electronAPI.validateSubscription(subscriptionKey);

            if (result.success) {
                // Apply any branding changes from the validation result
                if (result.appConfig) {
                    applyBranding(result.appConfig);
                }

                // Store subscription info
                localStorage.setItem('subscription', JSON.stringify({
                    key: subscriptionKey,
                    user: result.user,
                    subscription: result.subscription,
                    appConfig: result.appConfig
                }));

                window.location.href = 'channels.html';
            } else {
                showError(result.message || 'Invalid subscription key.');
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Connection error. Please try again.');
        } finally {
            setLoadingState(false);
        }
    }

    function applyBranding(config) {
        const appLogo = document.getElementById('appLogo');
        
        appTitle.textContent = config.title;
        document.title = config.title + ' - Login';
        
        // Apply color scheme
        if (config.colors) {
            document.documentElement.style.setProperty('--primary-color', config.colors.primary);
            document.documentElement.style.setProperty('--secondary-color', config.colors.secondary);
            document.documentElement.style.setProperty('--background-color', config.colors.background);
            document.documentElement.style.setProperty('--dark-color', config.colors.dark);
            document.documentElement.style.setProperty('--gray-color', config.colors.gray);
        }

        // Apply logo if available
        if (config.logo) {
            appLogo.src = config.logo;
            appLogo.style.display = 'block';
            appLogo.onerror = function() {
                // Hide logo if it fails to load
                this.style.display = 'none';
                console.warn('Failed to load logo:', config.logo);
            };
        } else {
            appLogo.style.display = 'none';
        }
    }

    function setLoadingState(loading) {
        loginBtn.disabled = loading;
        subscriptionKeyInput.disabled = loading;
        
        if (loading) {
            btnText.textContent = 'Validating...';
            spinner.style.display = 'inline-block';
        } else {
            btnText.textContent = 'Access Channels';
            spinner.style.display = 'none';
        }
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        setTimeout(hideError, 5000);
    }

    function hideError() {
        errorMessage.style.display = 'none';
    }

    subscriptionKeyInput.addEventListener('input', hideError);
});