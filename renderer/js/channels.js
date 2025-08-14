let shakaPlayer = null;
let currentChannel = null;
let isPlaying = false;
let controlsTimeout = null;
let currentUser = null;
let currentSubscription = null;

document.addEventListener('DOMContentLoaded', async () => {
    const packagesGrid = document.getElementById('packagesGrid');
    const channelsGrid = document.getElementById('channelsGrid');
    const refreshBtn = document.getElementById('refreshBtn');
    const darkModeBtn = document.getElementById('darkModeBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const playerModal = document.getElementById('playerModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const currentChannelName = document.getElementById('currentChannelName');
    const closePlayerBtn = document.getElementById('closePlayerBtn');
    const playerStatus = document.getElementById('playerStatus');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const appTitle = document.getElementById('appTitle');
    const userAvatar = document.getElementById('userAvatar');
    const userMenu = document.getElementById('userMenu');
    const backToPackages = document.getElementById('backToPackages');
    const packagesView = document.getElementById('packagesView');
    const channelsView = document.getElementById('channelsView');
    const packageTitle = document.getElementById('packageTitle');

    // User info elements
    const userName = document.getElementById('userName');
    const userMenuAvatar = document.getElementById('userMenuAvatar');
    const subscriptionStart = document.getElementById('subscriptionStart');
    const subscriptionEnd = document.getElementById('subscriptionEnd');

    // Controls
    const videoControls = document.getElementById('videoControls');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const volumeBtn = document.getElementById('volumeBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const qualitySelect = document.getElementById('qualitySelect');
    const subtitleSelect = document.getElementById('subtitleSelect');

    // Load user data from localStorage
    const subscriptionData = JSON.parse(localStorage.getItem('subscription') || '{}');
    if (subscriptionData.user) {
        currentUser = subscriptionData.user;
        currentSubscription = subscriptionData.subscription;
        setupUserAvatar();
    }

    // Load app config and update UI
    try {
        const config = await window.electronAPI.getAppConfig();
        if (config) {
            applyBranding(config);
            updateDarkModeButton(config.darkMode);
        }
    } catch (error) {
        console.error('Failed to load app config:', error);
    }

    // Load packages
    loadPackages();

    // Event listeners
    refreshBtn.addEventListener('click', loadPackages);
    darkModeBtn.addEventListener('click', toggleDarkMode);
    logoutBtn.addEventListener('click', handleLogout);
    closePlayerBtn.addEventListener('click', closePlayer);
    playPauseBtn.addEventListener('click', togglePlayPause);
    fullscreenBtn.addEventListener('click', toggleFullscreen);
    volumeBtn.addEventListener('click', toggleMute);
    volumeSlider.addEventListener('input', handleVolumeChange);
    qualitySelect.addEventListener('change', handleQualityChange);
    subtitleSelect.addEventListener('change', handleSubtitleChange);
    backToPackages.addEventListener('click', showPackagesView);

    // Close modal when clicking outside
    playerModal.addEventListener('click', (e) => {
        if (e.target === playerModal) {
            closePlayer();
        }
    });

    // Close user menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-avatar-container')) {
            userMenu.style.display = 'none';
        }
    });

    // Controls visibility
    const videoContainer = document.querySelector('.video-container');
    videoContainer.addEventListener('mouseenter', showControls);
    videoContainer.addEventListener('mouseleave', hideControlsDelayed);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (playerModal.style.display === 'none') return;

        switch(e.key) {
            case 'Escape':
                closePlayer();
                break;
            case 'F11':
                e.preventDefault();
                toggleFullscreen();
                break;
            case ' ':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'm':
                toggleMute();
                break;
            case 'f':
                toggleFullscreen();
                break;
        }
    });

    async function toggleDarkMode() {
        try {
            const result = await window.electronAPI.toggleDarkMode();
            if (result.success) {
                updateDarkModeButton(result.darkMode);
                document.documentElement.setAttribute('data-theme', result.darkMode ? 'dark' : 'light');
            }
        } catch (error) {
            console.error('Failed to toggle dark mode:', error);
        }
    }

    function updateDarkModeButton(isDark) {
        darkModeBtn.innerHTML = isDark ? '☀️ Light' : '🌙 Dark';
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }

    function setupUserAvatar() {
        if (currentUser) {
            // Set avatar
            if (currentUser.avatar) {
                userAvatar.src = currentUser.avatar;
                userAvatar.style.display = 'block';
                userMenuAvatar.src = currentUser.avatar;
            } else {
                // Show default avatar with user's initials
                const initials = currentUser.name ? currentUser.name.charAt(0).toUpperCase() : '👤';
                userAvatar.innerHTML = initials;
                userAvatar.style.display = 'flex';
                userMenuAvatar.style.display = 'none';
            }

            // Set user info in menu
            userName.textContent = currentUser.name || 'User';
            
            if (currentSubscription) {
                const startDate = new Date(currentSubscription.started).toLocaleDateString();
                const endDate = new Date(currentSubscription.end).toLocaleDateString();
                subscriptionStart.textContent = startDate;
                subscriptionEnd.textContent = endDate;
            }

            userAvatar.style.display = 'block';
        } else {
            userAvatar.style.display = 'none';
        }
    }

    function applyBranding(config) {
        const appLogo = document.getElementById('appLogo');
        
        appTitle.textContent = config.title;
        document.title = config.title + ' - Packages';
        
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
                this.style.display = 'none';
                console.warn('Failed to load logo:', config.logo);
            };
        } else {
            appLogo.style.display = 'none';
        }
    }

    async function loadPackages() {
        try {
            packagesGrid.innerHTML = '<div class="loading">Loading packages...</div>';

            const result = await window.electronAPI.getPackages();

            if (result.success) {
                displayPackages(result.packages);
            } else {
                packagesGrid.innerHTML = `<div class="error-card">Failed to load packages: ${result.message}</div>`;
            }
        } catch (error) {
            console.error('Error loading packages:', error);
            packagesGrid.innerHTML = '<div class="error-card">Error loading packages. Please try again.</div>';
        }
    }

    function displayPackages(packages) {
        if (packages.length === 0) {
            packagesGrid.innerHTML = '<div class="error-card">No packages available.</div>';
            return;
        }

        packagesGrid.innerHTML = packages.map(pkg => `
            <div class="package-card" data-package-id="${pkg.id}">
                <img src="${pkg.logo}" alt="${pkg.name}" class="package-logo"
                     onerror="this.style.backgroundColor='#f8f9fa'; this.style.display='flex'; this.style.alignItems='center'; this.style.justifyContent='center'; this.innerHTML='📦';">
                <div class="package-info">
                    <div class="package-name">${pkg.name}</div>
                    <div class="package-channels-count">${pkg.channels ? pkg.channels.length : 0} channels</div>
                </div>
            </div>
        `).join('');

        // Add click events
        document.querySelectorAll('.package-card').forEach(card => {
            card.addEventListener('click', () => {
                const packageId = parseInt(card.dataset.packageId);
                const pkg = packages.find(p => p.id === packageId);
                if (pkg) {
                    showChannelsView(pkg);
                }
            });
        });
    }

    function showChannelsView(pkg) {
        packagesView.style.display = 'none';
        channelsView.style.display = 'block';
        packageTitle.textContent = `${pkg.name} - Channels`;
        displayChannels(pkg.channels || []);
    }

    function showPackagesView() {
        channelsView.style.display = 'none';
        packagesView.style.display = 'block';
    }

    function displayChannels(channels) {
        if (channels.length === 0) {
            channelsGrid.innerHTML = '<div class="error-card">No channels in this package.</div>';
            return;
        }

        channelsGrid.innerHTML = channels.map(channel => `
            <div class="channel-card" data-channel-id="${channel.id}">
                <img src="${channel.logo}" alt="${channel.name}" class="channel-logo"
                     onerror="this.style.backgroundColor='#f8f9fa'; this.style.display='flex'; this.style.alignItems='center'; this.style.justifyContent='center'; this.innerHTML='📺';">
                <div class="channel-info">
                    <div class="channel-name">${channel.name}</div>
                    <div class="channel-status">LIVE</div>
                </div>
            </div>
        `).join('');

        // Add click events
        document.querySelectorAll('.channel-card').forEach(card => {
            card.addEventListener('click', () => {
                const channelId = parseInt(card.dataset.channelId);
                const channel = channels.find(c => c.id === channelId);
                if (channel) {
                    playChannel(channel);
                }
            });
        });
    }

    // Video player functions
    async function playChannel(channel) {
        currentChannel = channel;
        currentChannelName.textContent = channel.name;
        playerModal.style.display = 'flex';
        playerStatus.style.display = 'block';
        loadingSpinner.style.display = 'block';
        playerStatus.textContent = 'Loading stream...';
        resetControls();

        try {
            if (!shaka.Player.isBrowserSupported()) {
                throw new Error('Browser not supported');
            }

            if (shakaPlayer) {
                await shakaPlayer.destroy();
                shakaPlayer = null;
            }

            shakaPlayer = new shaka.Player(videoPlayer);

            shakaPlayer.addEventListener('error', (event) => {
                console.error('Shaka Player error:', event.detail);
                playerStatus.style.display = 'block';
                loadingSpinner.style.display = 'none';
                playerStatus.textContent = 'Playback failed: ' + (event.detail.message || 'Unknown error');
            });

            // Configure DRM if key exists
            if (channel.key) {
                const [kid, key] = channel.key.split(':');
                if (kid && key) {
                    shakaPlayer.configure({
                        drm: {
                            'clearKeys': {
                                [kid]: key
                            }
                        }
                    });
                }
            }

            await shakaPlayer.load(channel.mpd);

            // Setup quality and subtitle options
            setupQualitySelector();
            setupSubtitleSelector();
            videoPlayer.volume = volumeSlider.value / 100;

            try {
                await videoPlayer.play();
                isPlaying = true;
                updatePlayButton();
                playerStatus.style.display = 'none';
                loadingSpinner.style.display = 'none';
                hideControlsDelayed();
            } catch (playError) {
                console.warn('Autoplay failed:', playError);
                playerStatus.textContent = 'Click play to start';
                loadingSpinner.style.display = 'none';
                isPlaying = false;
                updatePlayButton();
                showControls();
            }

        } catch (error) {
            console.error('Error playing channel:', error);
            playerStatus.style.display = 'block';
            loadingSpinner.style.display = 'none';
            playerStatus.textContent = 'Failed to load stream: ' + error.message;
        }
    }

    function setupQualitySelector() {
        if (!shakaPlayer) return;

        try {
            const tracks = shakaPlayer.getVariantTracks();
            
            if (tracks && tracks.length > 1) {
                qualitySelect.innerHTML = '<option value="">Auto Quality</option>';
                
                // Sort tracks by bandwidth (quality)
                tracks.sort((a, b) => b.bandwidth - a.bandwidth);
                
                tracks.forEach((track) => {
                    const quality = Math.round(track.bandwidth / 1000);
                    const resolution = track.height ? `${track.width}x${track.height}` : '';
                    const label = resolution ? `${resolution} (${quality}k)` : `${quality}k`;
                    
                    const option = document.createElement('option');
                    option.value = track.id;
                    option.textContent = label;
                    qualitySelect.appendChild(option);
                });
                
                qualitySelect.style.display = 'block';
            }
        } catch (error) {
            console.error('Error setting up quality selector:', error);
        }
    }

    function setupSubtitleSelector() {
        if (!shakaPlayer) return;

        try {
            const textTracks = shakaPlayer.getTextTracks();
            
            if (textTracks && textTracks.length > 0) {
                subtitleSelect.innerHTML = '<option value="">No Subtitles</option>';
                
                textTracks.forEach((track) => {
                    const option = document.createElement('option');
                    option.value = track.id;
                    option.textContent = track.language || `Subtitle ${track.id}`;
                    subtitleSelect.appendChild(option);
                });
                
                subtitleSelect.style.display = 'block';
            }
        } catch (error) {
            console.error('Error setting up subtitle selector:', error);
        }
    }

    function handleQualityChange() {
        if (!shakaPlayer) return;

        const selectedTrackId = qualitySelect.value;

        if (selectedTrackId === '') {
            // Auto quality
            shakaPlayer.configure({
                abr: { enabled: true }
            });
        } else {
            // Fixed quality
            shakaPlayer.configure({
                abr: { enabled: false }
            });
            
            const tracks = shakaPlayer.getVariantTracks();
            const selectedTrack = tracks.find(t => t.id.toString() === selectedTrackId);
            if (selectedTrack) {
                shakaPlayer.selectVariantTrack(selectedTrack);
            }
        }
    }

    function handleSubtitleChange() {
        if (!shakaPlayer) return;

        const selectedTrackId = subtitleSelect.value;

        if (selectedTrackId === '') {
            // Disable subtitles
            shakaPlayer.setTextTrackVisibility(false);
        } else {
            // Enable selected subtitle track
            const textTracks = shakaPlayer.getTextTracks();
            const selectedTrack = textTracks.find(t => t.id.toString() === selectedTrackId);
            if (selectedTrack) {
                shakaPlayer.selectTextTrack(selectedTrack);
                shakaPlayer.setTextTrackVisibility(true);
            }
        }
    }

    function resetControls() {
        isPlaying = false;
        updatePlayButton();
        qualitySelect.innerHTML = '<option value="">Auto Quality</option>';
        qualitySelect.style.display = 'none';
        subtitleSelect.innerHTML = '<option value="">No Subtitles</option>';
        subtitleSelect.style.display = 'none';
    }

    function togglePlayPause() {
        if (!videoPlayer) return;

        if (isPlaying) {
            videoPlayer.pause();
            isPlaying = false;
            showControls();
        } else {
            videoPlayer.play().then(() => {
                isPlaying = true;
                hideControlsDelayed();
            }).catch(error => {
                console.error('Play failed:', error);
            });
        }
        updatePlayButton();
    }

    function updatePlayButton() {
        playPauseBtn.textContent = isPlaying ? '⏸️' : '▶️';
    }

    function toggleMute() {
        if (!videoPlayer) return;
        videoPlayer.muted = !videoPlayer.muted;
        volumeBtn.textContent = videoPlayer.muted ? '🔇' : '🔊';
    }

    function handleVolumeChange() {
        if (!videoPlayer) return;
        const volume = volumeSlider.value / 100;
        videoPlayer.volume = volume;
        videoPlayer.muted = volume === 0;
        volumeBtn.textContent = volume === 0 ? '🔇' : '🔊';
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            playerModal.requestFullscreen().catch(err => {
                console.error('Fullscreen error:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    function showControls() {
        videoControls.style.opacity = '1';
        clearTimeout(controlsTimeout);
    }

    function hideControlsDelayed() {
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(() => {
            if (isPlaying) {
                videoControls.style.opacity = '0';
            }
        }, 3000);
    }

    async function closePlayer() {
        if (shakaPlayer) {
            await shakaPlayer.destroy();
            shakaPlayer = null;
        }

        videoPlayer.src = '';
        playerModal.style.display = 'none';
        currentChannel = null;
        isPlaying = false;
        clearTimeout(controlsTimeout);

        if (document.fullscreenElement) {
            document.exitFullscreen();
        }
    }

    async function handleLogout() {
        try {
            await closePlayer();
            localStorage.removeItem('subscription');
            await window.electronAPI.logout();
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Logout error:', error);
            window.location.href = 'login.html';
        }
    }

    // Video events
    videoPlayer.addEventListener('playing', () => {
        isPlaying = true;
        updatePlayButton();
        playerStatus.style.display = 'none';
        loadingSpinner.style.display = 'none';
        hideControlsDelayed();
    });

    videoPlayer.addEventListener('pause', () => {
        isPlaying = false;
        updatePlayButton();
        showControls();
    });

    videoPlayer.addEventListener('waiting', () => {
        loadingSpinner.style.display = 'block';
    });

    videoPlayer.addEventListener('canplaythrough', () => {
        loadingSpinner.style.display = 'none';
    });

    videoPlayer.addEventListener('error', (e) => {
        console.error('Video error:', e);
        playerStatus.style.display = 'block';
        playerStatus.textContent = 'Video playback error';
        loadingSpinner.style.display = 'none';
    });
});

// Global function for user menu toggle
function toggleUserMenu() {
    const userMenu = document.getElementById('userMenu');
    userMenu.style.display = userMenu.style.display === 'none' ? 'block' : 'none';
}

