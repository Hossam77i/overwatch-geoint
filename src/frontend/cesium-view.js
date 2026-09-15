// cesium-view.js - Lazy loaded 3D engine

let viewer = null;
let cesiumEntities = {};
let is3DMode = false;
    document.body.classList.remove('gods-eye-mode');

window.toggle3DView = function() {
    if (!is3DMode) {
        enable3D();
    } else {
        disable3D();
    }
};

function enable3D() {
    is3DMode = true;
    document.body.classList.add('gods-eye-mode');
    document.getElementById('map').style.display = 'none';
    document.getElementById('cesiumContainer').style.display = 'block';
    document.getElementById('toggle3DBtn').textContent = '🗺️ 2D MODE';
    document.getElementById('panel-3d-controls').style.display = 'block';
    if (window.update3DSettings) window.update3DSettings();

    if (!window.Cesium) {
        logIntel("Initializing 3D Orbital Engine (Cesium)...", "info");
        const script = document.createElement('script');
        script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.107/Build/Cesium/Cesium.js';
        const link = document.createElement('link');
        link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.107/Build/Cesium/Widgets/widgets.css';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
        
        script.onload = async () => {
            
            Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IkdZS0t2NVpTTFFCUTZac3oiLCJqdGkiOiI1ZGY5ZWVlYy02YjMyLTQxOTYtODRlZi01NTE0MDcxNzRmOTEiLCJpZCI6NDk1NTI2LCJzdWIiOiJob3NzYW03NzYiLCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoicHJvamVjdCIsImlhdCI6MTc4OTQ3OTkyNn0.tqm8aciTaU5FitiJhK71f4lUSwBnhI5xaQOZFc0Kp_s';
            const satelliteProvider = new Cesium.UrlTemplateImageryProvider({
                url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                maximumLevel: 19
            });
            
            viewer = new Cesium.Viewer('cesiumContainer', {
                baseLayer: new Cesium.ImageryLayer(satelliteProvider),
                terrainProvider: Cesium.createWorldTerrainAsync ? await Cesium.createWorldTerrainAsync() : Cesium.createWorldTerrain(),
                terrainExaggeration: 1.5, // 🔥 GOD'S EYE FEATURE: Dramatic Mountains
                
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                animation: false,
                timeline: false,
                infoBox: true
            });
            
            // 🔥 POWER FEATURE: Dynamic Day/Night Cycle based on real sun position
            viewer.scene.globe.enableLighting = true;
            viewer.clock.shouldAnimate = true; // FORCE CLOCK TO TICK FOR LIVE TRACKING
            
            // 🔥 GOD'S EYE FEATURE: Cockpit View / Entity Tracking
            viewer.selectedEntityChanged.addEventListener(function(selectedEntity) {
                if (selectedEntity && selectedEntity.path) {
                    viewer.trackedEntity = selectedEntity;
                } else {
                    viewer.trackedEntity = undefined;
                }
            });
            
            // 🔥 POWER FEATURE: High-resolution atmosphere rendering
            viewer.scene.skyAtmosphere.hueShift = -0.05;
            viewer.scene.globe.depthTestAgainstTerrain = true; // Enable depth testing for real 3D terrain
            
            // 🔥 GOD'S EYE FEATURE: Photorealistic 3D Tiles & Buildings
            try {
                if (Cesium.createGooglePhotorealistic3DTileset) {
                    const tileset = await Cesium.createGooglePhotorealistic3DTileset();
                    window.cesiumBuildings = viewer.scene.primitives.add(tileset);
                } else if (Cesium.createOsmBuildingsAsync) {
                    const b = await Cesium.createOsmBuildingsAsync();
                    b.style = new Cesium.Cesium3DTileStyle({ color: "color('#445566', 0.8)" });
                    window.cesiumBuildings = viewer.scene.primitives.add(b);
                } else {
                    window.cesiumBuildings = viewer.scene.primitives.add(Cesium.createOsmBuildings());
                }
            } catch(e) {
                console.warn("3D Buildings not available with this token.");
                try {
                    const b = await Cesium.createOsmBuildingsAsync();
                    b.style = new Cesium.Cesium3DTileStyle({ color: "color('#445566', 0.8)" });
                    window.cesiumBuildings = viewer.scene.primitives.add(b);
                } catch(e2) { }
            }
            
            if (window.update3DSettings) window.update3DSettings();
            
            
            
            // Remove the default Cesium logo/credit text for a cleaner tactical look
            viewer.cesiumWidget.creditContainer.style.display = 'none';
            window.viewer = viewer;
            
            logIntel('3D Engine Online.', 'success');
            syncDataTo3D();
        };
        document.head.appendChild(script);
    } else {
        logIntel('3D Engine Online.', 'success');
            syncDataTo3D();
    }
}

function disable3D() {
    is3DMode = false;
    document.body.classList.remove('gods-eye-mode');
    document.getElementById('cesiumContainer').style.display = 'none';
    document.getElementById('map').style.display = 'block';
    document.getElementById('toggle3DBtn').textContent = '🌐 3D MODE';
    document.getElementById('panel-3d-controls').style.display = 'none';
    document.getElementById('hud-overlay').style.display = 'none';
    document.getElementById('scanlines').style.display = 'none';
    document.getElementById('hud-text').style.display = 'none';
}

// Subscribe to state updates from app.js
window.addEventListener('geoint:radar_update', (e) => {
    if (!viewer) return;
    const features = e.detail.features; // now expecting GeoJSON features
    // Render in Cesium
    const now = Date.now();
    features.forEach(feature => {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;
        const icao = props.icao;
        const lon = coords[0];
        const lat = coords[1];
        const alt = coords[2] || 0;
        
        if (lon && lat) {
            const position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
            const time = Cesium.JulianDate.now();
            
            if (cesiumEntities[icao]) {
                // 🔥 POWER FEATURE: Smooth interpolation between radar pings
                try { cesiumEntities[icao].position.addSample(time, position); } catch(e) {}
                cesiumEntities[icao].lastSeen = now;
            } else {
                const positionProperty = new Cesium.SampledPositionProperty();
                positionProperty.addSample(time, position);
                
                const headingRad = Cesium.Math.toRadians(props.heading || props.track || 0);
                const speedMps = (props.speed || props.gs || 400) * 0.514444;
                const dLat = (speedMps * 10 * Math.cos(headingRad)) / 111320;
                const dLon = (speedMps * 10 * Math.sin(headingRad)) / (111320 * Math.cos(Cesium.Math.toRadians(lat)));
                const futurePos = Cesium.Cartesian3.fromDegrees(lon + dLon, lat + dLat, alt);
                const futureTime = Cesium.JulianDate.addSeconds(time, 10, new Cesium.JulianDate());
                positionProperty.addSample(futureTime, futurePos);
                
                positionProperty.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
                positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.EXTRAPOLATE;
                
                
                const callsign = props.flight || icao;
                const speed = props.speed || props.gs || 0;
                const altM = Math.round((alt || 0) * 3.28084); // meters to feet for display
                const headingDeg = props.heading || props.track || 0;
                const type = props.t || "Unknown";
                const squawk = props.squawk || "None";
                
                const descHTML = `
                    <table class="cesium-infoBox-defaultTable">
                        <tbody>
                            <tr><th>Flight</th><td>${callsign}</td></tr>
                            <tr><th>Altitude</th><td>${altM} ft</td></tr>
                            <tr><th>Speed</th><td>${speed} kts</td></tr>
                            <tr><th>Heading</th><td>${headingDeg}°</td></tr>
                            <tr><th>Type</th><td>${type}</td></tr>
                            <tr><th>Squawk</th><td>${squawk}</td></tr>
                        </tbody>
                    </table>
                `;
                
                cesiumEntities[icao] = viewer.entities.add({
                    position: positionProperty,
                    description: descHTML,
                    name: callsign,
                    billboard: {
                        image: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cpath%20fill%3D%22yellow%22%20stroke%3D%22black%22%20stroke-width%3D%221%22%20d%3D%22M21%2C16V14L13%2C9V3.5C13%2C2.67%2012.33%2C2%2011.5%2C2C10.67%2C2%2010%2C2.67%2010%2C3.5V9L2%2C14V16L10%2C13.5V19L8%2C20.5V22L11.5%2C21L15%2C22V20.5L13%2C19V13.5L21%2C16Z%22%20%2F%3E%3C%2Fsvg%3E',
                        scale: 1.0,
                        rotation: Cesium.Math.toRadians(headingDeg),
                        alignedAxis: Cesium.Cartesian3.UNIT_Z,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    },
                    path: {
                        resolution: 1,
                        material: new Cesium.PolylineGlowMaterialProperty({
                            glowPower: 0.1,
                            color: Cesium.Color.YELLOW
                        }),
                        width: 3,
                        leadTime: 0,
                        trailTime: 60, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000000)
                    },
                    viewFrom: new Cesium.Cartesian3(0, -5000, 1500)
                });

                cesiumEntities[icao].lastSeen = now;
                // Add interpolation settings
                
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
        
        // 🔥 GOD'S EYE FEATURE: Always force cinematic pitch
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, alt),
            orientation: {
                heading: Cesium.Math.toRadians(0.0),
                pitch: Cesium.Math.toRadians(-60.0), // 30-degree tilt for cinematic 3D perspective
                roll: 0.0
            },
            duration: 1.5
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
    const assets = e.detail.features || e.detail.assets;
    if (!assets) return;
    const type = e.detail.type || 'Military';
    if (cesiumOsintEntities[type]) {
        cesiumOsintEntities[type].forEach(ent => viewer.entities.remove(ent));
    }
    cesiumOsintEntities[type] = [];
    
    assets.forEach(a => {
        const props = a.properties || a;
        const coords = a.geometry ? a.geometry.coordinates : [a.lon, a.lat];
        const ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1]),
            // 🔥 POWER FEATURE: Vertical tactical beam (laser) marking the target location
            polyline: {
                positions: [
                    Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
                    Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 15000)
                ],
                width: 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.2,
                    color: Cesium.Color.RED.withAlpha(0.7)
                })
            },
            point: { pixelSize: 12, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: { text: props.name || props.n || (props.tags ? props.tags.name : 'Unknown Target'), font: 'bold 11pt monospace', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) }
        });
        
        let cat = 'Military';
        if (props.t && props.t.includes("Aviation")) cat = 'Aviation';
        else if (props.t && props.t.includes("Energy")) cat = 'Energy';
        else if (props.t && props.t.includes("Highways")) cat = 'Highways';
        else if (props.tags) {
            if (props.tags.aeroway) cat = 'Aviation';
            else if (props.tags.power) cat = 'Energy';
            else if (props.tags.highway) cat = 'Highways';
        }
        
        if (!cesiumOsintEntities[cat]) cesiumOsintEntities[cat] = [];
        cesiumOsintEntities[cat].push(ent);
    });
});

let cesiumEarthquakes = [];

cesiumEarthquakes = [];
window.addEventListener('geoint:earthquakes', (e) => {
    if (!viewer) return;
    cesiumEarthquakes.forEach(ent => viewer.entities.remove(ent));
    cesiumEarthquakes = [];
    const data = e.detail;
    if (!data || !data.features) return;
    data.features.forEach(f => {
        const coords = f.geometry.coordinates;
        const ent = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1]),
            point: { pixelSize: 10, color: Cesium.Color.RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
            description: `Magnitude: ${f.properties.mag}<br>Place: ${f.properties.place}`
        });
        cesiumEarthquakes.push(ent);
    });
});

window.addEventListener('geoint:earthquakes_toggle', (e) => {
    if (!viewer) return;
    const show = e.detail.show;
    cesiumEarthquakes.forEach(ent => ent.show = show);
});

// Handle OSINT Filter Toggling in 3D
let cesiumOsintEntities = {
    'Military': [],
    'Energy': [],
    'Aviation': [],
    'Highways': []
};

window.addEventListener('geoint:osint_filter_toggle', (e) => {
    if (!viewer) return;
    const type = e.detail.type;
    const show = e.detail.show;
    if (cesiumOsintEntities[type]) {
        cesiumOsintEntities[type].forEach(ent => ent.show = show);
    }
});

window.update3DSettings = function() {
    if (!viewer) return;
    viewer.scene.globe.enableLighting = document.getElementById('toggle-lighting').checked;
    if (window.cesiumBuildings) {
        window.cesiumBuildings.show = document.getElementById('toggle-buildings').checked;
    }
    viewer.scene.globe.terrainExaggeration = document.getElementById('toggle-terrain').checked ? 1.5 : 1.0;
    
    const showHud = document.getElementById('toggle-hud').checked;
    document.getElementById('hud-overlay').style.display = showHud ? 'block' : 'none';
    document.getElementById('scanlines').style.display = showHud ? 'block' : 'none';
    document.getElementById('hud-text').style.display = showHud ? 'block' : 'none';
};

window.enterCockpitMode = async function() {
    if (!viewer) return;
    if (!window.radarActive) {
        document.getElementById('radarBtn').click();
    }
    const planeIds = Object.keys(cesiumEntities).filter(k => cesiumEntities[k].path);
    if (planeIds.length > 0) {
        viewer.selectedEntity = cesiumEntities[planeIds[Math.floor(Math.random() * planeIds.length)]];
        return;
    }
    
    const canvas = viewer.scene.canvas;
    const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const pickPos = viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid);
    const carto = viewer.camera.positionCartographic;
    let centerLat = Cesium.Math.toDegrees(carto.latitude);
    let centerLon = Cesium.Math.toDegrees(carto.longitude);
    if (pickPos) {
        const groundCarto = Cesium.Cartographic.fromCartesian(pickPos);
        centerLat = Cesium.Math.toDegrees(groundCarto.latitude);
        centerLon = Cesium.Math.toDegrees(groundCarto.longitude);
    }
    let span = carto.height > 2000000 ? 30.0 : 15.0;
    
    const req = {
        lat: centerLat, lon: centerLon, 
        width_deg: span*2, height_deg: span*2, filter: 'radar'
    };
    
    try {
        const res = await fetch("https://yyp1jlzcjf.execute-api.us-east-1.amazonaws.com/trigger-overwatch", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req)
        });
        const proxyData = await res.json();
        const data = proxyData.radar_data;
        if (data && data.features && data.features.length > 0) {
            window.dispatchEvent(new CustomEvent("geoint:radar_update", { detail: { features: data.features } }));
            setTimeout(() => {
                const newPlaneIds = Object.keys(cesiumEntities).filter(k => cesiumEntities[k].path);
                if (newPlaneIds.length > 0) {
                    viewer.selectedEntity = cesiumEntities[newPlaneIds[Math.floor(Math.random() * newPlaneIds.length)]];
                } else {
                    alert("No aircraft detected in this sector right now. Try panning the map.");
                }
            }, 500);
        } else {
            alert("No aircraft detected in this sector right now. Try panning the map.");
        }
    } catch(e) {
        alert("Radar scan failed: " + e.message);
    }
};
