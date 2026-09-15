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
            const satelliteProvider = new Cesium.UrlTemplateImageryProvider({
                url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                maximumLevel: 19
            });
            
            viewer = new Cesium.Viewer('cesiumContainer', {
                baseLayer: new Cesium.ImageryLayer(satelliteProvider),
                
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
        viewer.entities.add({
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
    });
});
