const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const template = fs.readFileSync(require('node:path').join(__dirname, '../web/service-worker.js'), 'utf8');
const scope = 'https://example.com/vegas-road-trip-2026/';
const prefix = `vegas-itinerary:${scope}:`;
const bodies = { 'index.html': '<p>Trip</p>', 'manifest.webmanifest': '{}' };
const assets = Object.fromEntries(Object.entries(bodies).map(([path,body]) => [path,createHash('sha256').update(body).digest('hex')]));
function worker(version, stores, options = {}) {
    const events = {};
    let claimed = false;
    let skipped = false;
    const fetch = async url => {
        if (options.fail) throw new Error('Offline');
        const path = new URL(typeof url === 'string' ? url : url.url).pathname.split('/').at(-1);
        return new Response(options.corrupt ? 'Wrong version' : bodies[path]);
    };
    const caches = {
        async open(name) {
            if (!stores.has(name)) stores.set(name,new Map());
            const store = stores.get(name);
            return {
                async put(url,response) { store.set(url,response.clone()); },
                async match(url) { return store.get(url)?.clone(); }
            };
        },
        async keys() { return [...stores.keys()]; },
        async delete(name) { return stores.delete(name); }
    };
    vm.runInNewContext(template.replace('__ASSETS__',JSON.stringify(assets)).replace('__VERSION__',version), {
        self: {
            registration: {scope},
            clients: {async claim() { claimed=true; }},
            async skipWaiting() { skipped=true; },
            addEventListener(name,callback) { events[name]=callback; }
        }, caches, fetch, crypto:webcrypto, URL, Uint8Array, Response
    });
    async function dispatch(type,extra={}) {
        let promise;
        events[type]({ ...extra, waitUntil(value) { promise=value; }, respondWith(value) { promise=value; } });
        return await promise;
    }
    return {dispatch, get claimed(){return claimed;},get skipped(){return skipped;}};
}
test('complete installation serves scope root and index offline and reports readiness', async () => {
    const stores=new Map();
    const first=worker('v1',stores);
    await first.dispatch('install');
    await first.dispatch('activate');
    assert.equal(first.claimed,true);
    assert.equal(first.skipped,false);
    const offline=worker('v1',stores,{fail:true});
    for (const suffix of ['', 'index.html', '?source=homescreen']) {
        const response=await offline.dispatch('fetch',{request:new Request(scope+suffix)});
        assert.equal(await response.text(),bodies['index.html']);
    }
    let ready;
    await offline.dispatch('message',{data:{type:'CHECK_OFFLINE'},ports:[{postMessage(message){ready=message.ready;}}]});
    assert.equal(ready,true);
    stores.get(prefix+'v1').delete(scope+'manifest.webmanifest');
    await offline.dispatch('message',{data:{type:'CHECK_OFFLINE'},ports:[{postMessage(message){ready=message.ready;}}]});
    assert.equal(ready,false);
    assert.equal(await offline.dispatch('fetch',{request:new Request('https://example.com/another-site/')}),undefined);
});
test('failed first install never reports a usable cache',async()=>{
    const stores=new Map();
    const first=worker('v1',stores,{fail:true});
    await assert.rejects(first.dispatch('install'),/Offline/);
    assert.equal(stores.has(prefix+'v1'),false);
});
test('failed and mixed-version updates preserve the previous working cache',async()=>{
    const stores=new Map();
    await worker('v1',stores).dispatch('install');
    for (const options of [{fail:true},{corrupt:true}]) {
        await assert.rejects(worker('v2',stores,options).dispatch('install'));
        assert.equal(stores.has(prefix+'v1'),true);
        assert.equal(stores.has(prefix+'v2'),false);
    }
});
test('successful update waits for activation and only removes this app’s old cache',async()=>{
    const stores=new Map([['unrelated-cache',new Map()]]);
    await worker('v1',stores).dispatch('install');
    const next=worker('v2',stores);
    await next.dispatch('install');
    assert.equal(stores.has(prefix+'v1'),true);
    assert.equal(next.skipped,false);
    await next.dispatch('message',{data:{type:'ACTIVATE_UPDATE'}});
    assert.equal(next.skipped,true);
    await next.dispatch('activate');
    assert.equal(stores.has(prefix+'v1'),false);
    assert.equal(stores.has(prefix+'v2'),true);
    assert.equal(stores.has('unrelated-cache'),true);
});
test('retry repairs missing cached assets without discarding a saved page on failure',async()=>{
    const stores=new Map();
    await worker('v1',stores).dispatch('install');
    stores.get(prefix+'v1').delete(scope+'manifest.webmanifest');
    let ready;
    const message={data:{type:'REPAIR_OFFLINE'},ports:[{postMessage(value){ready=value.ready;}}]};
    await worker('v1',stores,{fail:true}).dispatch('message',message);
    assert.equal(ready,false);
    assert.ok(stores.get(prefix+'v1').has(scope+'index.html'));
    await worker('v1',stores).dispatch('message',message);
    assert.equal(ready,true);
    assert.ok(stores.get(prefix+'v1').has(scope+'manifest.webmanifest'));
});
