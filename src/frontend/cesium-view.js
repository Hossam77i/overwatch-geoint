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
            
            Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6Il9nSnYtckgtWENYbDZYYkYiLCJqdGkiOiJmNTg1ZDQ3Ni02YmNmLTRjYjItYjI0MS1iNzc3YThkMmRmYTgiLCJpZCI6NDk1NTI2LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODk0NzQ3MTl9.NhSZ5xbWdU5Afx4m6oBOmbfyqA4p7YMSonnwjcxBN4Q';
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
                infoBox: false
            });
            
            // 🔥 POWER FEATURE: Dynamic Day/Night Cycle based on real sun position
            viewer.scene.globe.enableLighting = true;
            
            // 🔥 GOD'S EYE FEATURE: Cockpit View / Entity Tracking
            viewer.selectedEntityChanged.addEventListener(function(selectedEntity) {
                if (selectedEntity && selectedEntity.path) {
                    viewer.trackedEntity = selectedEntity;
                    // Zoom in closely behind the aircraft for a cinematic cockpit/chase view
                    viewer.zoomTo(selectedEntity, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(0), Cesium.Math.toRadians(-15), 5000));
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
                console.error("Failed to load 3D tiles:", e);
            }
            
            if (window.update3DSettings) window.update3DSettings();
            
            
            
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
                
                cesiumEntities[icao] = viewer.entities.add({
                    position: positionProperty,
                    point: { pixelSize: 8, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
                    label: { text: props.flight || icao, font: '10pt monospace', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) },
                    // 🔥 POWER FEATURE: Tactical Flight Trails
                    path: {
                        resolution: 1,
                        material: new Cesium.PolylineGlowMaterialProperty({
                            glowPower: 0.1,
                            color: Cesium.Color.YELLOW
                        }),
                        width: 3,
                        leadTime: 0,
                        trailTime: 60 // Leaves a 60-second trail behind the aircraft
                    }
                });
                cesiumEntities[icao].lastSeen = now;
                // Add interpolation settings
                cesiumEntities[icao].position.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
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
    if (!viewer) return;
    
    // Sync current center/zoom from Leaflet
    if (window.map) {
        const center = window.map.getCenter();
        const alt = Math.max(10000, 20000000 / Math.pow(2, window.map.getZoom()));
        
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, alt),
            orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-60.0), roll: 0.0 },
            duration: 1.5
        });
        
        // Extract features from Leaflet
        const features = [];
        window.map.eachLayer(layer => {
            if (layer.feature) features.push(layer.feature);
        });
        
        const time = Cesium.JulianDate.now();
        
        features.forEach(feature => {
            const props = feature.properties;
            const coords = feature.geometry.coordinates;
            const icao = props.icao;
            const lon = coords[0];
            const lat = coords[1];
            const alt_val = coords[2] || 0;
            
            if (lon && lat) {
                const position = Cesium.Cartesian3.fromDegrees(lon, lat, alt_val);
                
                if (icao) { // It's an aircraft
                    if (!cesiumEntities[icao]) {
                        const positionProperty = new Cesium.SampledPositionProperty();
                        positionProperty.addSample(time, position);
                        
                        cesiumEntities[icao] = viewer.entities.add({
                            position: positionProperty,
                            point: { pixelSize: 8, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
                            path: { resolution: 1, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: Cesium.Color.YELLOW }), width: 3, leadTime: 0, trailTime: 60 },
                            description: `ICAO: ${icao}<br>Flight: ${props.callsign || 'N/A'}`
                        });
                    }
                } else if (props.t) { // It's an OSINT Target
                    // Generate unique ID based on coords
                    const osintId = `osint_${lon}_${lat}`;
                    if (!cesiumEntities[osintId]) {
                        const ent = viewer.entities.add({
                            position: position,
                            polyline: { positions: [position, Cesium.Cartesian3.fromDegrees(lon, lat, 15000)], width: 5, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.2, color: Cesium.Color.RED.withAlpha(0.6) }) },
                            label: { text: 'TARGET DETECTED', font: '14pt Share Tech Mono', style: Cesium.LabelStyle.FILL_AND_OUTLINE, fillColor: Cesium.Color.RED, outlineWidth: 3, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) }
                        });
                        cesiumEntities[osintId] = ent;
                        
                        let cat = 'Military';
                        if (props.t.includes("Aviation")) cat = 'Aviation';
                        else if (props.t.includes("Energy")) cat = 'Energy';
                        else if (props.t.includes("Highways")) cat = 'Highways';
                        
                        if (!cesiumOsintEntities[cat]) cesiumOsintEntities[cat] = [];
                        cesiumOsintEntities[cat].push(ent);
                    }
                }
            }
        });
        
        // Sync Earthquakes if fetched in 2D
        if (window.lastEarthquakesGeoJSON) {
            window.dispatchEvent(new CustomEvent("geoint:earthquakes", { detail: window.lastEarthquakesGeoJSON }));
        }
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
                
                cesiumEntities[icao] = viewer.entities.add({
                    position: positionProperty,
                    point: { pixelSize: 8, color: Cesium.Color.YELLOW, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
                    label: { text: props.flight || icao, font: '10pt monospace', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) },
                    // 🔥 POWER FEATURE: Tactical Flight Trails
                    path: {
                        resolution: 1,
                        material: new Cesium.PolylineGlowMaterialProperty({
                            glowPower: 0.1,
                            color: Cesium.Color.YELLOW
                        }),
                        width: 3,
                        leadTime: 0,
                        trailTime: 60 // Leaves a 60-second trail behind the aircraft
                    }
                });
                cesiumEntities[icao].lastSeen = now;
                // Add interpolation settings
                cesiumEntities[icao].position.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
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
    const assets = e.detail.assets;
    if (!assets) return;
    
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
            label: { text: props.name || props.n, font: 'bold 11pt monospace', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -9) }
        });
        
        let cat = 'Military';
        if (props.t.includes("Aviation")) cat = 'Aviation';
        else if (props.t.includes("Energy")) cat = 'Energy';
        else if (props.t.includes("Highways")) cat = 'Highways';
        
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
