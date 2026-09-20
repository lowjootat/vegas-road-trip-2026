(async () => {
    const status = document.getElementById('offline-status');
    const action = document.getElementById('offline-action');
    let registration;
    let updating = false;
    let checking = 0;
    let updateFailed = false;
    async function storageProtected() {
        try {
            return await navigator.storage?.persisted?.() === true;
        } catch {
            return false;
        }
    }
    async function requestStorageProtection() {
        const installed = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
        try {
            if (installed && !await storageProtected()) await navigator.storage?.persist?.();
        } catch {
            // Persistence is optional; cached files remain available without it.
        }
        await refreshStatus();
    }
    function show(text, label, handler) {
        status.textContent = text;
        action.hidden = !label;
        action.textContent = label || '';
        action.onclick = handler || null;
    }
    function checkController(type = 'CHECK_OFFLINE') {
        return new Promise((resolve, reject) => {
            const controller = navigator.serviceWorker.controller;
            if (!controller) return resolve(false);
            const channel = new MessageChannel();
            const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Offline check timed out')); }, type === 'REPAIR_OFFLINE' ? 60000 : 8000);
            channel.port1.onmessage = event => {
                clearTimeout(timer);
                channel.port1.close();
                resolve(event.data.ready === true);
            };
            controller.postMessage({ type }, [channel.port2]);
        });
    }
    async function refreshStatus() {
        const check = ++checking;
        try {
            const ready = await checkController();
            const protectedStorage = ready && await storageProtected();
            const readyLabel = protectedStorage ? 'Ready offline · Storage protected' : 'Ready offline';
            if (check !== checking || updating) return;
            if (registration?.waiting) {
                show(ready ? 'Update available · Current version ready offline' : 'Update available', 'Update & reload', () => {
                    updating = true;
                    show('Applying update…');
                    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
                });
            } else if (ready) {
                show(updateFailed ? `${readyLabel} · Update could not download` : readyLabel, updateFailed ? 'Retry update' : null, start);
            } else if (registration?.installing || registration?.active?.state === 'activating') {
                show('Saving for offline use…');
            } else {
                show('Not saved offline. Connect to the internet and retry.', 'Retry', start);
            }
        } catch {
            if (check === checking) show('Could not verify offline saving.', 'Retry', start);
        }
    }
    function watch(worker) {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
            if (worker.state === 'redundant') updateFailed = true;
            if (['installed', 'activated', 'redundant'].includes(worker.state)) refreshStatus();
        });
    }
    async function start() {
        show('Saving for offline use…');
        updateFailed = false;
        try {
            registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
            registration.onupdatefound = () => watch(registration.installing);
            watch(registration.installing);
            if (!registration.installing) await registration.update();
            if (navigator.serviceWorker.controller && !registration.installing && !registration.waiting && !await checkController()) {
                await checkController('REPAIR_OFFLINE');
            }
        } catch {
            updateFailed = true;
        }
        await refreshStatus();
    }
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        show('Offline installation is unavailable in this browser. Use Safari over HTTPS.');
        return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updating) location.reload();
        else refreshStatus();
    });
    window.addEventListener('online', start);
    window.addEventListener('pageshow', refreshStatus);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
    void requestStorageProtection();
    await start();
})();
