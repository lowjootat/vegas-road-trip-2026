const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ids = ['fri', 'sat', 'sun', 'mon', 'tue'];
let scrollY = 0;
let scrollLeft = 0;
let barWidth = 350;
let layoutShift = 0;
const frames = [];
const events = {};
let onResize;
const sections = ids.map((id, index) => ({
    getBoundingClientRect: () => ({ top: 1000 + index * 2000 + layoutShift - scrollY }),
    scrollIntoView: () => { scrollY = 1000 + index * 2000 + layoutShift - 76; }
}));
const buttons = ids.map((id, index) => ({
    dataset: { target: id },
    active: false,
    attributes: {},
    classList: { toggle: (_, active) => { buttons[index].active = active; } },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    getBoundingClientRect: () => ({ left: index * 130 - scrollLeft, right: index * 130 + 122 - scrollLeft })
}));
const bar = {
    getBoundingClientRect: () => ({ left: 0, right: barWidth }),
    scrollBy: ({ left }) => { scrollLeft = Math.max(0, Math.min(642 - barWidth, scrollLeft + left)); }
};
const source = fs.readFileSync(path.join(__dirname, '../web/itinerary.js'), 'utf8');
vm.runInNewContext(source.slice(0, source.indexOf('const mapPlaces')), {
    document: {
        querySelectorAll: () => buttons,
        getElementById: id => sections[ids.indexOf(id)],
        querySelector: selector => selector === '.daybar' ? bar : { getBoundingClientRect: () => ({ height: 68 }) }
    },
    window: { addEventListener: (name, callback) => { events[name] = callback; } },
    requestAnimationFrame: callback => frames.push(callback),
    ResizeObserver: class { constructor(callback) { onResize = callback; } observe() {} }
});
function flush() { while (frames.length) frames.shift()(); }
function expectDay(index) {
    flush();
    assert.deepEqual(buttons.filter(b => b.active), [buttons[index]]);
    assert.equal(buttons[index].attributes['aria-current'], 'date');
    assert.equal(buttons.filter(b => b.attributes['aria-current']).length, 1);
    const bounds = buttons[index].getBoundingClientRect();
    assert.ok(bounds.left >= 0 && bounds.right <= barWidth, 'Active date must be fully visible');
}
expectDay(0);
// Large jumps, reverse scrolling, and the last date must all update the pill.
for (const index of [1, 3, 4, 2, 0]) {
    scrollY = 1000 + index * 2000 + 600;
    events.scroll();
    const position = scrollY;
    expectDay(index);
    assert.equal(scrollY, position, 'Revealing a pill must not scroll the page');
}
// Crossing the header boundary in either direction changes the selected day.
scrollY = 3000 - 85;
events.scroll();
expectDay(0);
scrollY += 2;
events.scroll();
expectDay(1);
scrollY -= 2;
events.scroll();
expectDay(0);
buttons[4].onclick();
events.scroll();
expectDay(4);
barWidth = 240;
events.resize();
expectDay(4);
// Loaded images can move the current section without a scroll event.
layoutShift = 1000;
onResize();
expectDay(3);
events.scroll();
events.scroll();
assert.equal(frames.length, 1, 'Scroll events should share one animation frame');
flush();
console.log('Date navigation regression checks passed');
