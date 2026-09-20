function scheduleState(schedule, now) {
    const active = schedule.find(item => Date.parse(item.startAt) <= now && now < Date.parse(item.endAt));
    if (active) return { kind: 'active', target: active, clockAt: active.startAt };
    const next = schedule.find(item => Date.parse(item.startAt) > now);
    if (next) {
        const previous = [...schedule].reverse().find(item => Date.parse(item.endAt) <= now);
        return { kind: previous ? 'gap' : 'before', target: next, clockAt: previous ? previous.endAt : next.startAt };
    }
    return { kind: 'complete', target: null, clockAt: schedule.at(-1)?.endAt };
}

function scheduleClock(now, timestamp, includeDate = false) {
    const offset = timestamp.slice(-6);
    const minutes = (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) * (offset[0] === '-' ? -1 : 1);
    const date = new Date(now + minutes * 60000);
    const label = date.toLocaleString('en-US', {
        timeZone: 'UTC', hour: 'numeric', minute: '2-digit',
        ...(includeDate ? { month: 'short', day: 'numeric' } : {})
    });
    return `${label} UTC${offset.replace('-', '−')}`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { scheduleState, scheduleClock };
} else {
    const schedule = JSON.parse(document.getElementById('schedule-data').textContent)
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    const bar = document.querySelector('.now-bar');
    const status = document.getElementById('schedule-status');
    const jump = document.getElementById('jump-now');
    const marker = document.createElement('span');
    marker.className = 'now-marker';
    let currentArticle;
    let target;
    function updateClock() {
        const now = Date.now();
        const state = scheduleState(schedule, now);
        target = state.target && document.getElementById(state.target.id);
        const article = state.kind === 'active' ? target : null;
        if (currentArticle !== article) {
            if (currentArticle) {
                currentArticle.classList.remove('is-now');
                currentArticle.removeAttribute('aria-current');
            }
            marker.remove();
            if (article) {
                article.classList.add('is-now');
                article.setAttribute('aria-current', 'step');
                article.querySelector('.time').prepend(marker);
            }
            currentArticle = article;
        }
        if (state.kind === 'active') {
            marker.textContent = `Now · ${scheduleClock(now, state.clockAt)}`;
            status.textContent = `Scheduled now · ${state.target.location}`;
        } else if (state.kind === 'before') {
            status.textContent = `Trip starts ${scheduleClock(Date.parse(state.target.startAt), state.target.startAt, true)}`;
        } else if (state.kind === 'gap') {
            status.textContent = `${scheduleClock(now, state.clockAt)} · Next: ${state.target.location} · ${scheduleClock(Date.parse(state.target.startAt), state.target.startAt, true)}`;
        } else {
            status.textContent = 'Trip complete';
        }
        jump.hidden = !target;
        jump.textContent = state.kind === 'active' ? 'Jump to now' : 'Jump to next';
    }
    if (schedule.length) {
        bar.hidden = false;
        jump.addEventListener('click', () => target?.scrollIntoView({
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'
        }));
        updateClock();
        setInterval(() => { if (!document.hidden) updateClock(); }, 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
        window.addEventListener('pageshow', updateClock);
        window.addEventListener('focus', updateClock);
        const header = document.querySelector('.daywrap');
        new ResizeObserver(() => document.documentElement.style.setProperty('--day-header-height', `${header.getBoundingClientRect().height + 16}px`)).observe(header);
    }
}
