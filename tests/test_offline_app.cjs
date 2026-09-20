const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync('web/offline-app.js', 'utf8');

async function openApp({ installed = true, ios = false, cached = true, storage, updateFails = false } = {}) {
    const status = {}, action = {}, events = {};
    const registration = { update: async () => { if (updateFails) throw Error('Offline'); } };
    const context = {
        navigator: { storage, standalone: ios, serviceWorker: {
            controller: { postMessage: (_, [port]) => queueMicrotask(() => port.deliver(cached)) },
            register: async () => registration, addEventListener() {},
        } },
        window: { isSecureContext: true, matchMedia: () => ({ matches: installed }), addEventListener() {} },
        document: { getElementById: id => id === 'offline-status' ? status : action,
            addEventListener: (name, handler) => { events[name] = handler; } },
        MessageChannel: class {
            constructor() {
                this.port1 = { close() {} };
                this.port2 = { deliver: ready => this.port1.onmessage({ data: { ready } }) };
            }
        },
        setTimeout, clearTimeout,
    };
    await vm.runInNewContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return { status, action, events };
}

test('installed app requests persistence and confirms it before showing protection', async () => {
    for (const ios of [false, true]) {
        let granted = false, requests = 0;
        const app = await openApp({ installed: !ios, ios, storage: {
            persisted: async () => granted,
            persist: async () => { requests++; granted = true; return true; },
        } });
        assert.equal(requests, 1);
        assert.equal(app.status.textContent, 'Ready offline · Storage protected');
        granted = false;
        app.events.visibilitychange();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(app.status.textContent, 'Ready offline');
    }
});

test('denial, unavailable APIs, and errors retain ordinary offline readiness', async () => {
    for (const storage of [undefined, {},
        { persisted: async () => false, persist: async () => false },
        { persisted: async () => false, persist: async () => true },
        { persisted: async () => { throw Error('Unavailable'); }, persist: async () => { throw Error('Denied'); } },
    ]) {
        assert.equal((await openApp({ storage })).status.textContent, 'Ready offline');
    }
});

test('browser tab does not request persistence; existing grants are recognized', async () => {
    for (const granted of [false, true]) {
        let requests = 0;
        const { status } = await openApp({ installed: false, storage: {
            persisted: async () => granted, persist: async () => { requests++; },
        } });
        assert.equal(requests, 0);
        assert.equal(status.textContent, granted ? 'Ready offline · Storage protected' : 'Ready offline');
    }
});

test('existing persistence avoids another request and never implies files are cached', async () => {
    let requests = 0;
    const storage = { persisted: async () => true, persist: async () => { requests++; } };
    const { status } = await openApp({ cached: false, storage });
    assert.equal(requests, 0);
    assert.equal(status.textContent, 'Not saved offline. Connect to the internet and retry.');
    assert.equal((await openApp({ storage, updateFails: true })).status.textContent,
        'Ready offline · Storage protected · Update could not download');
});
