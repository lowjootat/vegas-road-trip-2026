const bs = [...document.querySelectorAll('.daybtn')],
    ss = bs.map(b => document.getElementById(b.dataset.target));
bs.forEach(b => b.onclick = () => document.getElementById(b.dataset.target).scrollIntoView({
    behavior: 'smooth'
}));
const daybar = document.querySelector('.daybar');
const daywrap = document.querySelector('.daywrap');
let activeDayButton;
let dayFramePending = false;

function updateActiveDay() {
    dayFramePending = false;
    const headerBottom = daywrap.getBoundingClientRect().height + 16;
    let activeIndex = 0;
    ss.forEach((section, index) => {
        if (section.getBoundingClientRect().top <= headerBottom) activeIndex = index;
    });
    const button = bs[activeIndex];
    if (button !== activeDayButton) {
        bs.forEach(b => {
            b.classList.toggle('active', b === button);
            if (b === button) b.setAttribute('aria-current', 'date');
            else b.removeAttribute('aria-current');
        });
        activeDayButton = button;
    }
    const barBounds = daybar.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    if (buttonBounds.left < barBounds.left || buttonBounds.right > barBounds.right) {
        // Assign scrollLeft directly: Safari can ignore ScrollToOptions on restored
        // horizontal scrollers, leaving the active day clipped off-screen.
        const delta = buttonBounds.left < barBounds.left
            ? buttonBounds.left - barBounds.left - 8
            : buttonBounds.right - barBounds.right + 8;
        daybar.scrollLeft += delta;
    }
}

function scheduleDayUpdate() {
    if (dayFramePending) return;
    dayFramePending = true;
    requestAnimationFrame(updateActiveDay);
}

window.addEventListener('scroll', scheduleDayUpdate, { passive: true });
window.addEventListener('resize', scheduleDayUpdate);
window.addEventListener('pageshow', () => {
    scheduleDayUpdate();
    // Run once more after Safari restores nested scroll positions.
    requestAnimationFrame(scheduleDayUpdate);
});
new ResizeObserver(scheduleDayUpdate).observe(document.querySelector('main'));
scheduleDayUpdate();
const mapPlaces = JSON.parse(document.getElementById("map-data").textContent);
const palette = ['#c65a31', '#d98b28', '#3975a9', '#69459b', '#365c3d'];
const mapColors = Object.fromEntries(bs.map((button, index) => [button.dataset.target, palette[index % palette.length]]));
const filterButtons = [...document.querySelectorAll('.map-filter')];
if (window.L) {
    const offlineGeography = JSON.parse(document.getElementById("geography-data").textContent);
    const tripBounds = L.latLngBounds([
        [34.5, -116.5],
        [38, -110.5]
    ]);
    const tripMap = L.map('trip-map', {
        scrollWheelZoom: false,
        minZoom: 6,
        maxZoom: 11,
        maxBounds: tripBounds,
        maxBoundsViscosity: 1,
        preferCanvas: true
    }).setView([36.55, -112.65], 7);
    tripMap.attributionControl.setPrefix('Leaflet');
    tripMap.attributionControl.addAttribution('Map data: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
    L.geoJSON(offlineGeography.states, {
        interactive: false,
        style: {
            color: '#b9ad96',
            weight: 1.5,
            dashArray: '5 5'
        }
    }).addTo(tripMap);
    L.geoJSON(offlineGeography.lakes, {
        interactive: false,
        style: {
            color: '#8bb5c2',
            weight: 1,
            fillColor: '#bdd9df',
            fillOpacity: 1
        }
    }).addTo(tripMap);
    L.geoJSON(offlineGeography.rivers, {
        interactive: false,
        style: {
            color: '#9dbecb',
            weight: 1.2
        }
    }).addTo(tripMap);
    L.geoJSON(offlineGeography.roads, {
        interactive: false,
        style: feature => ({
            color: feature.properties.major ? '#c9a46b' : '#d7c6a8',
            weight: feature.properties.major ? 2 : 1,
            opacity: .9
        })
    }).addTo(tripMap);

    function townLabel(latlng, name) {
        const label = document.createElement('span');
        label.textContent = name;
        return L.marker(latlng, {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
                className: 'offline-town',
                html: label,
                iconSize: [110, 18],
                iconAnchor: [-5, 9]
            })
        }).addTo(tripMap);
    }
    offlineGeography.towns.features.forEach(feature => townLabel([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], feature.properties.name));
    // These trip towns supplement Natural Earth's sparse regional place labels.
    [
        [37.0475, -112.5263, 'Kanab'],
        [36.9147, -111.4558, 'Page'],
        [37.1889, -112.9986, 'Springdale'],
        [35.2495, -112.1910, 'Williams'],
        [35.9736, -112.1266, 'Tusayan']
    ].forEach(([lat, lng, name]) => {
        if (!offlineGeography.towns.features.some(f => f.properties.name === name)) townLabel([lat, lng], name);
    });
    L.control.scale({
        imperial: false
    }).addTo(tripMap);
    L.polyline(mapPlaces.map(p => [p.lat, p.lng]), {
        color: '#a84b2a',
        weight: 3,
        opacity: .65,
        dashArray: '7 7'
    }).addTo(tripMap);
    const markerLayer = L.layerGroup().addTo(tripMap);
    function renderMarkers(selected) {
        markerLayer.clearLayers();
        const visible = selected === 'all' ? mapPlaces : mapPlaces.filter(p => p.days.includes(selected));
        visible.forEach(p => {
            const color = mapColors[p.days[0]];
            const icon = L.divIcon({
                className: 'leaflet-div-icon',
                html: '<span class="route-dot" style="background:' + color + '">' + p.n + '</span>',
                iconSize: [30, 30],
                iconAnchor: [15, 15],
                popupAnchor: [0, -12]
            });
            const popup = document.createElement('div');
            const name = document.createElement('b');
            name.textContent = p.name;
            const meta = document.createElement('span');
            meta.textContent = p.day + ' · ' + p.time;
            popup.append(name, meta);
            L.marker([p.lat, p.lng], {
                icon,
                title: p.name,
                alt: p.name,
                riseOnHover: true
            }).bindPopup(popup).addTo(markerLayer);
        });
        const bounds = L.latLngBounds(visible.map(p => [p.lat, p.lng]));
        if (bounds.isValid()) tripMap.fitBounds(bounds, {
            padding: [28, 28],
            maxZoom: selected === 'all' ? 7 : 11
        })
    }
    renderMarkers('all');
    filterButtons.forEach(button => button.onclick = () => {
        filterButtons.forEach(b => b.classList.toggle('active', b === button));
        renderMarkers(button.dataset.mapDay)
    });
    setTimeout(() => tripMap.invalidateSize(), 50)
} else {
    document.querySelector('.map-error').classList.add('show')
}
document.querySelectorAll('[data-check]').forEach(box => {
    const key = 'vegas-trip-' + box.dataset.check;
    try {
        const saved = localStorage.getItem(key);
        if (saved !== null) box.checked = saved === '1'
    } catch {}
    box.addEventListener('change', () => {
        try {
            localStorage.setItem(key, box.checked ? '1' : '0')
        } catch {}
    })
});

const offlinePhotos = JSON.parse(document.getElementById("photo-data").textContent);
document.querySelectorAll("[data-photo]").forEach(img => {
    img.src = offlinePhotos[img.dataset.photo]
});
document.documentElement.style.setProperty("--hero-photo", 'url("' + offlinePhotos[document.body.dataset.hero] + '")');
