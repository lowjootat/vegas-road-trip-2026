const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scheduleState, scheduleClock } = require('../web/current-time.js');
const data = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../data/itinerary.json'), 'utf8'));
const schedule = data.days.flatMap(day => day.activities).filter(item => item.startAt).sort((a,b) => Date.parse(a.startAt)-Date.parse(b.startAt));
const at = timestamp => scheduleState(schedule, Date.parse(timestamp));
test('exact boundaries select the next activity, with an exclusive end', () => {
    assert.equal(at('2026-09-25T07:15:00-07:00').target.id, 'fri-1-las-vegas');
    assert.equal(at('2026-09-25T08:00:00-07:00').target.id, 'fri-uber-to-alamo');
    assert.equal(at('2026-09-29T18:00:00-07:00').kind, 'complete');
});
test('active progress tracks the current position within an activity', () => {
    const hour = [{
        id: 'hour', location: 'Test',
        startAt: '2026-09-26T17:00:00-07:00',
        endAt: '2026-09-26T18:00:00-07:00'
    }];
    assert.equal(scheduleState(hour, Date.parse('2026-09-26T17:00:00-07:00')).progress, 0);
    assert.equal(scheduleState(hour, Date.parse('2026-09-26T17:30:00-07:00')).progress, 0.5);
    assert.equal(scheduleState(hour, Date.parse('2026-09-26T17:45:00-07:00')).progress, 0.75);
});
test('before, gaps, overnight and completion do not invent an active activity', () => {
    assert.equal(at('2026-09-20T12:00:00-07:00').kind, 'before');
    const gap = at('2026-09-25T15:45:00-06:00');
    assert.equal(gap.kind, 'gap');
    assert.equal(gap.target.id, 'fri-6-zion');
    assert.equal(at('2026-09-26T01:00:00-06:00').target.id, 'sat-1-watchman-campground');
    assert.equal(at('2026-10-01T00:00:00Z').kind, 'complete');
    assert.ok(!schedule.some(item => item.id === 'fri-5-parus-trail'));
});
test('cross-zone drives use absolute time and departure clock until arrival', () => {
    const drive = at('2026-09-25T12:00:00-07:00');
    assert.equal(drive.target.id, 'fri-3-las-vegas-zion');
    assert.match(scheduleClock(Date.parse('2026-09-25T12:00:00-07:00'), drive.clockAt), /12:00 PM UTC−07:00/);
    assert.match(at('2026-09-25T14:45:00-06:00').clockAt, /-06:00$/);
    assert.equal(at('2026-09-26T14:59:00-07:00').target.id, 'sat-7-kanab-wahweap');
    assert.match(at('2026-09-26T14:59:00-07:00').clockAt, /-06:00$/);
    assert.match(at('2026-09-26T15:00:00-07:00').clockAt, /-07:00$/);
});
test('Lone Rock remains on Arizona time regardless of device timezone', () => {
    const now = Date.parse('2026-09-26T17:00:00-07:00');
    const original = process.env.TZ;
    for (const zone of ['America/Denver', 'America/Los_Angeles', 'Asia/Singapore']) {
        process.env.TZ = zone;
        const state = scheduleState(schedule, now);
        assert.equal(state.target.id, 'sat-17-lone-rock-beach');
        assert.match(scheduleClock(now, state.clockAt), /5:00 PM UTC−07:00/);
    }
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
});

test('test clock changes jump targets, ticks forward, and resets to device time', () => {
    let deviceNow = Date.parse('2026-09-20T12:00:00-07:00');
    let tick;
    let scrolledTo;
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            textContent: '', value: '', hidden: false, events: {},
            addEventListener(name, callback) { this.events[name] = callback; },
            classList: { add() {}, remove() {} },
            style: {
                setProperty(name, value) { this[name] = value; },
                removeProperty(name) { delete this[name]; }
            },
            setAttribute() {}, removeAttribute() {}, remove() {},
            querySelector() { return { prepend() {} }; },
            scrollIntoView() { scrolledTo = id; }
        });
        return elements.get(id);
    }
    element('schedule-data').textContent = JSON.stringify(schedule);
    const context = {
        Date: class extends Date { static now() { return deviceNow; } },
        document: {
            hidden: false, getElementById: element, createElement: element,
            querySelector: element, addEventListener() {}
        },
        window: { addEventListener() {} },
        ResizeObserver: class { observe() {} },
        setInterval(callback) { tick = callback; },
        matchMedia: () => ({ matches: true })
    };
    require('node:vm').runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../web/current-time.js'), 'utf8'), context);
    const jump = element('jump-now');
    const status = element('schedule-status');
    const apply = () => element('clock-test-form').events.submit({ preventDefault() {} });
    assert.equal(element('clock-test-time').value, '2026-09-25T07:10');
    apply();
    assert.match(status.textContent, /^Test clock/);
    assert.equal(jump.textContent, 'Jump to next');
    jump.events.click();
    assert.equal(scrolledTo, 'fri-1-las-vegas');
    deviceNow += 5 * 60000;
    tick();
    assert.equal(jump.textContent, 'Jump to now');
    element('clock-test-time').value = '2026-09-26T08:45';
    apply();
    const active = scheduleState(schedule, Date.parse('2026-09-26T08:45:00-07:00')).target;
    assert.equal(element(active.id).style['--now-marker-top'], 'calc(var(--timeline-node-y) + 50% + 5px)');
    deviceNow += 60000;
    tick();
    assert.notEqual(element(active.id).style['--now-marker-top'], 'calc(var(--timeline-node-y) + 50% + 5px)');
    element('clock-test-time').value = '2026-09-25T14:45';
    apply();
    assert.equal(element(active.id).style['--now-marker-top'], undefined);
    assert.equal(jump.textContent, 'Jump to next');
    jump.events.click();
    assert.equal(scrolledTo, 'fri-6-zion');
    element('clock-test-time').value = '2026-10-01T00:00';
    apply();
    assert.equal(jump.hidden, true);
    element('clock-reset').events.click();
    assert.equal(jump.hidden, false);
    assert.doesNotMatch(status.textContent, /Test clock/);
    jump.events.click();
    assert.equal(scrolledTo, 'fri-1-las-vegas');
});
