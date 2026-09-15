// cesium-view.js - Lazy loaded 3D engine

let viewer = null;
let cesiumEntities = {};
let is3DMode = false;

window.toggle3DView = function() {
    if (!is3DMode) {
        enable3D();
    } else {
        disable3D();
    }
};

function enable3D() {
    is3DMode = true;
    document.getElementById('map').style.display = 'none';
    document.getElementById('cesiumContainer').style.display = 'block';
    document.getElementById('toggle3DBtn').textContent = '🗺️ 2D MODE';

    if (!window.Cesium) {
        logIntel("Initializing 3D Orbital Engine (Cesium)...", "info");
        const script = document.createElement('script');
        script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.107/Build/Cesium/Cesium.js';
        const link = document.createElement('link');
        link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.107/Build/Cesium/Widgets/widgets.css';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
        
        script.onload = () => {
            const osmProvider = new Cesium.UrlTemplateImageryProvider({
                url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'
            });
            
            viewer = new Cesium.Viewer('cesiumContainer', {
                baseLayer: new Cesium.ImageryLayer(osmProvider),
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                animation: false,
                timeline: false,
                infoBox: false
            });
            
            // Remove the default Cesium logo/credit text for a cleaner tactical look
            viewer.cesiumWidget.creditContainer.style.display = 'none';
            
            syncDataTo3D();
        };
        document.head.appendChild(script);
    } else {
        syncDataTo3D();
    }
}

function disable3D() {
    is3DMode = false;
    document.getElementById('cesiumContainer').style.display = 'none';
    document.getElementById('map').style.display = 'block';
    document.getElementById('toggle3DBtn').textContent = '🌐 3D MODE';
}

// Subscribe to state updates from app.js
window.addEventListener('geoint:radar_update', (e) => {
    if (!viewer) return;
    const states = e.detail.states; // expecting the raw states array
    // Render in Cesium
    const now = Date.now();
    states.forEach(state => {
        const icao = state[0];
        const lon = state[5];
        const lat = state[6];
        const alt = state[7] || 0;
        
        if (lon && lat) {
            if (cesiumEntities[icao]) {
                cesiumEntities[icao].position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
                cesiumEntities[icao].lastSeen = now;
            } else {
                cesiumEntities[icao] = viewer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
                    point: { pixelSize: 8, color: Cesium.Color.YELLOW },
                    label: { text: state[1] || icao, font: '10pt monospace', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) }
                });
                cesiumEntities[icao].lastSeen = now;
            }
        }
    });

    // Prune ghosts
    for (let id in cesiumEntities) {
        if (now - cesiumEntities[id].lastSeen > 25000) {
            viewer.entities.remove(cesiumEntities[id]);
            delete cesiumEntities[id];
        }
    }
});

function syncDataTo3D() {
    // Sync current center/zoom from Leaflet
    if (window.map && viewer) {
        const center = window.map.getCenter();
        const alt = Math.max(10000, 20000000 / Math.pow(2, window.map.getZoom()));
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, alt),
            duration: 1.0
        });
    }
}

window.addEventListener('geoint:map_move', (e) => {
    if (is3DMode && viewer) {
        // We could sync map -> 3D if needed, but usually they are independent when active
    }
});

window.addEventListener('geoint:osint_update', (e) => {
    if (!viewer) return;
    const assets = e.detail.assets;
    if (!assets) return;
    
    assets.forEach(a => {
        viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat),
            point: { pixelSize: 10, color: Cesium.Color.RED },
            label: { text: a.name, font: '10pt monospace', style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) }
        });
    });
});
