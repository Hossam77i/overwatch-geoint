
        // FULL-WORLD SATELLITE, EDGE TO EDGE: fractional zoom fitted so the
        // planet exactly fills the panel width. No duplicates, no margins,
        // tiles served at z3 where Esri coverage is complete (no gray gaps).
        const map = L.map('map', { preferCanvas: true, center: [20.0, 10.0], zoom: 3, backgroundColor: '#000000', zoomControl: false, zoomSnap: 0, zoomDelta: 0.5, maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 0.7 });
        window.map = map;
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        let drawMode = false;
        let drawStart = null;
        let currentBox = null;
        let drawnBounds = null;

        function toggleDrawMode() {
            drawMode = !drawMode;
            const btn = document.getElementById("drawBtn");
            if (drawMode) {
                btn.style.background = "#00ffcc";
                btn.style.color = "#000";
                map.dragging.disable();
                document.getElementById("map").style.cursor = "crosshair";
                logIntel("Draw Mode ACTIVATED. Click and drag on the map to define the Tactical Frame.", "success");
            } else {
                btn.style.background = "transparent";
                btn.style.color = "var(--text-2)";
                map.dragging.enable();
                document.getElementById("map").style.cursor = "";
            }
        }

        map.on('mousedown', function(e) {
            if (!drawMode) return;
            drawStart = e.latlng;
            if (currentBox) { map.removeLayer(currentBox); }
            drawnBounds = null;
        });

        map.on('mousemove', function(e) {
            if (!drawMode || !drawStart) return;
            const bounds = L.latLngBounds(drawStart, e.latlng);
            if (!currentBox) {
                currentBox = L.rectangle(bounds, {color: "#00ffcc", weight: 2, fillOpacity: 0.1, dashArray: "5, 10"}).addTo(map);
            } else {
                currentBox.setBounds(bounds);
            }
        });

        map.on('mouseup', function(e) {
            if (!drawMode || !drawStart) return;
            drawnBounds = L.latLngBounds(drawStart, e.latlng);
            drawStart = null;
            toggleDrawMode();
            
            // Set the target automatically
            const c = drawnBounds.getCenter();
            document.getElementById('locationSearch').value = `Frame: ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`;
            currentTarget = { lat: c.lat, lon: c.lng, locked: true, customBounds: drawnBounds };
            logIntel(`Tactical Frame Locked: ${drawnBounds.toBBoxString()}`, "success");
            
            // Task 3: Automatically trigger the Computer Vision scan immediately after drawing the box
            setTimeout(executeScan, 300);
        });

        // --- LIVE RADAR (ADS-B OpenSky) ---
        window.radarActive = false; let radarActive = false;
        let radarInterval = null;
        let radarMarkers = [];

        function toggleLiveRadar() {
            radarActive = !radarActive; window.radarActive = radarActive;
            const btn = document.getElementById("radarBtn");
            if (radarActive) {
                btn.style.background = "#ffea00";
                btn.style.color = "#000";
                logIntel("Live Radar ACTIVATED. Tracking real-time airspace transponders...", "crisis");
                fetchLiveRadar(true);
                radarInterval = setInterval(() => fetchLiveRadar(false), 12000); 
            } else {
                btn.style.background = "transparent";
                btn.style.color = "var(--info)";
                clearInterval(radarInterval);
                Object.values(activePlanes).forEach(p => map.removeLayer(p.marker));
                activePlanes = {};
                radarQueue.length = 0;
                logIntel("Live Radar DEACTIVATED.", "info");
            }
        }

        const radarQueue = [];
        let radarQueueProcessing = false;
        let lastRadarFetch = 0;
        let activePlanes = {}; // Store planes by ICAO for smooth updates

        async function processRadarQueue() {
            if (radarQueueProcessing) return;
            radarQueueProcessing = true;
            
            while (radarQueue.length > 0) {
                const req = radarQueue.shift();
                
                // Add a strict 10-second timeout so the queue NEVER hangs
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                
                try {
                    // Strictly clamp coordinates to valid global bounds (-90 to 90, -180 to 180)
                    const s = Math.max(-89.9, Math.min(89.9, req.s)).toFixed(4);
                    const n = Math.max(-89.9, Math.min(89.9, req.n)).toFixed(4);
                    const w = Math.max(-179.9, Math.min(179.9, req.w)).toFixed(4);
                    const e = Math.max(-179.9, Math.min(179.9, req.e)).toFixed(4);
                    
                    // Backend Serverless Proxy (Bypasses Browser CORS Blocks & IP Bans)
                    const w_width = e - w;
                    const w_height = n - s;
                    const c_lat = (parseFloat(s) + parseFloat(n)) / 2;
                    const c_lon = (parseFloat(w) + parseFloat(e)) / 2;

                    const res = await fetch(TRIGGER_URL, { headers: { "Content-Type": "application/json" },
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            lat: c_lat, 
                            lon: c_lon, 
                            width_deg: w_width, 
                            height_deg: w_height, 
                            filter: 'radar' 
                        }),
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (!res.ok) {
                        const txt = await res.text();
                        throw new Error(`Proxy HTTP ${res.status}: ${txt.substring(0, 40)}`);
                    }
                    const proxyData = await res.json();
                    
                    if (proxyData.status === "error") {
                        throw new Error(`ADSB Error: ${proxyData.message}`);
                    }

                    const data = proxyData.radar_data;
                    
                    if (data && data.type === "FeatureCollection" && data.features.length > 0) {
                        renderRadarData(data.features);
                    } else if (!req.isBackground) {
                        logIntel(`[RADAR] Airspace clear. 0 active transponders inside this ${w},${s} sector.`, "warn");
                    }
                } catch(e) {
                    clearTimeout(timeoutId);
                    if (e.name === 'AbortError' || (e.message && (e.message.includes('Timeout') || e.message.includes('timed out') || e.message.includes('HTTP Error 5')))) {
                        logIntel("[RADAR] Remote Sensor degraded (API Timeout). Retrying...", "warn");
                    } else {
                        logIntel(`[RADAR] Target Tracking Interruption: ${e.message.substring(0,40)}`, "warn");
                    }
                }
                await new Promise(r => setTimeout(r, 1500));
            }
            radarQueueProcessing = false;
        }

        window.fetchLiveRadar = fetchLiveRadar; function fetchLiveRadar(isPan = false) {
            if (!radarActive) return;
            
            const now = Date.now();
            if (isPan && now - lastRadarFetch < 3000) return; 
            if (isPan) lastRadarFetch = now;
            
            if (isPan) {
                radarQueue.length = 0; 
                Object.values(activePlanes).forEach(p => map.removeLayer(p.marker));
                activePlanes = {};
            }
            
            // Get bounds depending on active engine
            let lamin, lomin, lamax, lomax;
            if (window.is3DMode && window.viewer) {
                const rect = window.viewer.camera.computeViewRectangle();
                if (rect) {
                    lamin = Cesium.Math.toDegrees(rect.south);
                    lamax = Cesium.Math.toDegrees(rect.north);
                    lomin = Cesium.Math.toDegrees(rect.west);
                    lomax = Cesium.Math.toDegrees(rect.east);
                    const w_pad = Math.abs(lomax - lomin) * 0.5;
                    const h_pad = Math.abs(lamax - lamin) * 0.5;
                    lamin -= h_pad; lamax += h_pad;
                    lomin -= w_pad; lomax += w_pad;
                } else {
                    // Fallback: If camera is pitched (Gods Eye), computeViewRectangle returns undefined.
                    // Instead, use the exact camera center and pad by an arbitrary large radius.
                    const carto = window.viewer.camera.positionCartographic;
                    const centerLat = Cesium.Math.toDegrees(carto.latitude);
                    const centerLon = Cesium.Math.toDegrees(carto.longitude);
                    // Approximate size based on height
                    let span = 5.0; // 5 degrees is ~500km
                    if (carto.height > 500000) span = 15.0;
                    if (carto.height > 2000000) span = 30.0;
                    
                    lamin = centerLat - span; lamax = centerLat + span;
                    lomin = centerLon - span; lomax = centerLon + span;
                }
            } else if (window.map) {
                const bounds = window.map.getBounds().pad(1.5);
                lamin = bounds.getSouth(); lomin = bounds.getWest();
                lamax = bounds.getNorth(); lomax = bounds.getEast();
            }
            
            const MAX_SPAN = 15;
            const w = Math.abs(lomax - lomin);
            const h = Math.abs(lamax - lamin);
            
            if (w > MAX_SPAN || h > MAX_SPAN) {
                if (isPan) logIntel("[RADAR] Wide Sector Detected. Focused scan initiated at map center...", "info");
                const midLat = (lamin + lamax) / 2;
                const midLon = (lomin + lomax) / 2;
                lamin = Math.max(-89, midLat - MAX_SPAN/2);
                lamax = Math.min(89, midLat + MAX_SPAN/2);
                lomin = Math.max(-179, midLon - MAX_SPAN/2);
                lomax = Math.min(179, midLon + MAX_SPAN/2);
                
                const mLat = (lamin + lamax) / 2;
                const mLon = (lomin + lomax) / 2;
                // Execute a single, highly-efficient wide-area sweep instead of 4 quadrants to prevent API rate limits
                radarQueue.push({s: lamin, w: lomin, n: lamax, e: lomax, isBackground: !isPan});
            } else {
                radarQueue.push({s: lamin, w: lomin, n: lamax, e: lomax, isBackground: !isPan});
            }
            
            processRadarQueue();
        }

        function renderRadarData(states) {
            window.dispatchEvent(new CustomEvent("geoint:radar_update", { detail: { features: states } }));
            const now = Date.now();
            states.forEach(feature => {
                const props = feature.properties;
                const coords = feature.geometry.coordinates;
                const icao = props.icao;
                const callsign = props.flight || "UNKNOWN";
                const originCountry = (props.origin || "UNKNOWN").replace(/'/g, "");
                const lon = coords[0], lat = coords[1];
                
                if (lon && lat) {
                    const alt = coords[2] || 0;
                    const vel = props.velocity || 0, track = props.heading || 0;
                    
                    const htmlContent = `<div style="transform: rotate(${track}deg); color: #ffea00; font-size: 16px; text-shadow: 0 0 5px #000;">✈</div><div style="color: #00ffcc; font-size: 9px; font-family: monospace; white-space: nowrap; margin-top: -4px;">${callsign}</div>`;
                    
                    const popupContent = `
                        <div style="font-family: monospace; font-size: 11px; padding: 4px;">
                            <strong style="color:var(--info); font-size:13px; display:block; margin-bottom:4px; border-bottom:1px solid #333; padding-bottom:4px;">FLIGHT ${callsign}</strong>
                            <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:8px;">
                                <div><span style="color:#666;">ID:</span> ${icao.toUpperCase()}</div>
                                <div><span style="color:#666;">ALT:</span> ${(alt).toFixed(0)} m</div>
                                <div><span style="color:#666;">SPD:</span> ${(vel * 3.6).toFixed(0)} km/h</div>
                                <div><span style="color:#666;">HDG:</span> ${(track || 0).toFixed(1)}°</div>
                            </div>
                            <button onclick="showAirplaneProfile('${icao}', '${callsign}', ${alt}, ${vel}, ${track}, '${originCountry}', ${lat}, ${lon})" style="width:100%; background:var(--info); color:#000; font-weight:bold; border:none; padding:6px; cursor:pointer; font-size:10px; border-radius:4px; text-transform:uppercase;">VIEW TACTICAL PROFILE</button>
                        </div>
                    `;
                    
                    if (activePlanes[icao]) {
                        // Smoothly update position without blinking
                        activePlanes[icao].marker.setLatLng([lat, lon]);
                        activePlanes[icao].marker.getPopup().setContent(popupContent);
                        const icon = L.divIcon({ html: htmlContent, className: 'radar-plane', iconSize: [20, 20], iconAnchor: [10, 10] });
                        activePlanes[icao].marker.setIcon(icon);
                        activePlanes[icao].lastSeen = now;
                        activePlanes[icao].data = { callsign, alt, vel, track, lat, lon };
                    } else {
                        // Create new plane
                        const icon = L.divIcon({ html: htmlContent, className: 'radar-plane', iconSize: [20, 20], iconAnchor: [10, 10] });
                        const m = L.marker([lat, lon], { icon: icon }).addTo(map).bindPopup(popupContent);
                        activePlanes[icao] = { marker: m, lastSeen: now, data: { callsign, alt, vel, track, lat, lon } };
                    }
                }
            });
            
            // Prune ghosts (planes that flew out of bounds or stopped broadcasting)
            for (let id in activePlanes) {
                if (now - activePlanes[id].lastSeen > 25000) {
                    map.removeLayer(activePlanes[id].marker);
                    delete activePlanes[id];
                }
            }
        }
        
        let moveTimer;
        map.on('moveend', () => { 
            if (!radarActive) return;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(() => fetchLiveRadar(true), 800); 
        });

        // Highly optimized native layer (avoids scary blob:S3 URLs)
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
            attribution: 'Tiles &copy; Esri', 
            maxZoom: 19, 
            maxNativeZoom: 18, 
            detectRetina: false, 
            noWrap: true, 
            updateWhenIdle: true, 
            keepBuffer: 3 
        }).addTo(map);

        const seaLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
            attribution: 'OpenSeaMap'
        });

        // Add layer control for the user to toggle
        const overlayMaps = {
            "🚢 Nautical Shipping Lanes": seaLayer
        };
        L.control.layers(null, overlayMaps, {position: 'topright'}).addTo(map);

        function fitWorld(forceView) {
            map.invalidateSize();
            const w = document.getElementById('map').clientWidth || 1500;
            const z = Math.log2(w / 256);
            map.setMinZoom(z);
            window._fitZ = z;
            if (forceView) map.setView([20.0, 10.0], z);
        }
        fitWorld(true);
        window.addEventListener('resize', () => {
            const w = document.getElementById('map').clientWidth || 1500;
            const z = Math.log2(w / 256);
            map.setMinZoom(z);
            window._fitZ = z;
            if (map.getZoom() < z) map.setView([20.0, 10.0], z);
        });

        const TRIGGER_URL = window.OVERWATCH_CONFIG.TRIGGER_URL;
        let currentTarget = null;
        let overlays = [];

        // --- HARDCODED 12-HOUR DB CACHE (Used only if Live API fails) ---
        const LOCAL_DB_CACHE = [
            {lat: 30.1219, lon: 31.4056, type: "Aviation Hub", name: "Cairo International Airport"},
            {lat: 23.9700, lon: 32.8800, type: "Energy Plant", name: "Aswan High Dam Power Station"},
            {lat: 31.1900, lon: 29.8700, type: "Military Base", name: "Alexandria Naval Base"},
            {lat: 30.9320, lon: 29.5690, type: "Military Base", name: "El Dabaa Military Garrison"},
            {lat: 27.2000, lon: 33.8000, type: "Aviation Hub", name: "Hurghada Airbase"},
            {lat: 29.9333, lon: 32.5500, type: "Energy Plant", name: "Suez Thermal Power Plant"},
            
            {lat: 55.9726, lon: 37.4146, type: "Aviation Hub", name: "Sheremetyevo Airport"},
            {lat: 43.1155, lon: 131.8855, type: "Military Base", name: "Pacific Fleet HQ (Vladivostok)"},
            {lat: 51.6700, lon: 35.6000, type: "Energy Plant", name: "Kursk Nuclear Power Plant"},
            {lat: 69.0600, lon: 33.4200, type: "Military Base", name: "Severomorsk Northern Fleet"},
            
            {lat: 39.2241, lon: 125.6702, type: "Aviation Hub", name: "Pyongyang Sunan Airport"},
            {lat: 39.8000, lon: 125.7500, type: "Energy Plant", name: "Yongbyon Nuclear Scientific Research Center"},
            {lat: 38.6500, lon: 128.1500, type: "Military Base", name: "Wonsan Naval Base"},
            
            {lat: 26.6400, lon: 50.1600, type: "Energy Plant", name: "Ras Tanura Oil Facility"},
            {lat: 24.7100, lon: 46.7200, type: "Military Base", name: "King Salman Air Base"},
            
            {lat: 27.1400, lon: 56.0500, type: "Military Base", name: "Bandar Abbas Naval Base"},
            {lat: 28.8200, lon: 50.8800, type: "Energy Plant", name: "Bushehr Nuclear Power Plant"}
        ];

        let markerClusters = null;

        function logIntel(msg, type="info") {
            const div = document.createElement("div");
            div.className = `log-entry fresh ${type}`;
            const t = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            div.innerHTML = `<span class="log-time">[${t}]</span>> ${msg}`;
            const feed = document.getElementById("logs");
            feed.prepend(div);
            while (feed.children.length > 80) feed.removeChild(feed.lastChild);
            const cc = document.getElementById("logCount");
            if (cc) cc.textContent = feed.children.length;
            setTimeout(() => div.classList.remove("fresh"), 1300);
        }

        function clearOverlays() {
            overlays.forEach(layer => map.removeLayer(layer));
            overlays = [];
            if (markerClusters) {
                map.removeLayer(markerClusters);
                markerClusters = null;
            }
            if (currentBox) { map.removeLayer(currentBox); currentBox = null; }
        }

        function resetView() {
            clearOverlays();
            map.flyTo([20.0, 10.0], window._fitZ || 2.5, {duration: 1.5});
            document.getElementById('locationSearch').value = '';
            document.getElementById('suggestBox').style.display = 'none';
            document.getElementById('countrySelect').value = 'GLOBAL';
            const items = document.querySelectorAll('.hvt-list li');
            items.forEach(li => li.style.display = 'block');
            renderInfra('GLOBAL');
            logIntel("System Reset to Global View.", "success");
        }

        const COUNTRY_INFRA = {
            EGYPT: { flag: "🇪🇬", name: "Egypt", center: [26.8206, 30.8025], zoom: 6, summary: "Chokepoint state: Suez Canal + 3 ports + 2 airbases + 2 power plants under watch.",
                assets: [
                    { t: "Maritime", n: "Suez Canal (Ismailia sector)", d: "Chokepoint · 12km convoy spacing", s: "Operational", c: "ib-op", lat: 30.42, lon: 32.34, q: "Suez Canal", k: "maritime" },
                    { t: "Maritime", n: "Alexandria Port", d: "Container + naval berths", s: "Operational", c: "ib-op", lat: 31.19, lon: 29.87, q: "Alexandria Port, Egypt", k: "maritime" },
                    { t: "Military", n: "Alexandria Naval Base", d: "Surface fleet HQ", s: "Elevated", c: "ib-deg", lat: 31.19, lon: 29.87, q: "Alexandria Naval Base", k: "macro" },
                    { t: "Aviation", n: "Cairo International Airport", d: "Hub · dual runway ops", s: "Operational", c: "ib-op", lat: 30.1219, lon: 31.4056, q: "Cairo International Airport", k: "aviation" },
                    { t: "Aviation", n: "Borg El Arab International", d: "Civil/Military joint", s: "Operational", c: "ib-op", lat: 30.917, lon: 29.596, q: "Borg El Arab Airport", k: "aviation" },
                    { t: "Aviation", n: "Sharm El Sheikh International", d: "Tourism hub", s: "Operational", c: "ib-op", lat: 27.977, lon: 34.394, q: "Sharm El Sheikh Airport", k: "aviation" },
                    { t: "Aviation", n: "Hurghada International", d: "Red Sea logistics", s: "Operational", c: "ib-op", lat: 27.186, lon: 33.799, q: "Hurghada Airport", k: "aviation" },
                    { t: "Aviation", n: "Luxor International", d: "Southern anchor", s: "Operational", c: "ib-op", lat: 25.670, lon: 32.706, q: "Luxor Airport", k: "aviation" },
                    { t: "Energy", n: "Suez Thermal Power Plant", d: "650MW · grid anchor", s: "Degraded", c: "ib-deg", lat: 29.9333, lon: 32.55, q: "Suez Thermal Power Plant", k: "energy" }
                ] },
            IRAN: { flag: "🇮🇷", name: "Iran / Gulf", center: [32.4279, 53.6880], zoom: 5, summary: "Gulf pressure zone: Hormuz crisis watch + Bandar Abbas + Bushehr nuclear.",
                assets: [
                    { t: "Maritime", n: "Strait of Hormuz", d: "CRISIS · tanker transit at risk", s: "Critical", c: "ib-crit", lat: 26.56, lon: 56.27, q: "Strait of Hormuz", k: "macro" },
                    { t: "Military", n: "Bandar Abbas Naval Base", d: "IRGCN fast-attack staging", s: "Elevated", c: "ib-deg", lat: 27.14, lon: 56.05, q: "Bandar Abbas Naval Base", k: "macro" },
                    { t: "Energy", n: "Bushehr Nuclear Power Plant", d: "1GW VVER · IAEA watched", s: "Operational", c: "ib-op", lat: 28.82, lon: 50.88, q: "Bushehr Nuclear Power Plant", k: "energy" }
                ] },
            RUSSIA: { flag: "🇷🇺", name: "Russia", center: [61.5240, 105.3188], zoom: 3, summary: "Two-fleet posture: Northern Fleet + Pacific Fleet + strategic airlift hub.",
                assets: [
                    { t: "Aviation", n: "Sheremetyevo Airport", d: "Strategic airlift + intl hub", s: "Operational", c: "ib-op", lat: 55.9726, lon: 37.4146, q: "Sheremetyevo International Airport", k: "aviation" },
                    { t: "Military", n: "Pacific Fleet HQ (Vladivostok)", d: "SSN/SSGN + surface group", s: "Elevated", c: "ib-deg", lat: 43.1155, lon: 131.8855, q: "Vladivostok, Russia", k: "macro" },
                    { t: "Military", n: "Severomorsk Northern Fleet", d: "SSBN bastion · Kola", s: "Elevated", c: "ib-deg", lat: 69.06, lon: 33.42, q: "Severomorsk", k: "macro" },
                    { t: "Energy", n: "Kursk Nuclear Power Plant", d: "RBMK successor units", s: "Operational", c: "ib-op", lat: 51.67, lon: 35.6, q: "Kursk Nuclear Power Plant", k: "energy" }
                ] },
            NORTH_KOREA: { flag: "🇰🇵", name: "North Korea", center: [40.3399, 127.5101], zoom: 6, summary: "Closed theater: Sunan air gateway + Yongbyon nuclear + east-coast naval node.",
                assets: [
                    { t: "Aviation", n: "Pyongyang Sunan Airport", d: "Sole intl gateway", s: "Operational", c: "ib-op", lat: 39.2241, lon: 125.6702, q: "Pyongyang Sunan International Airport", k: "aviation" },
                    { t: "Energy", n: "Yongbyon Nuclear Center", d: "5MWe + enrichment watch", s: "Elevated", c: "ib-deg", lat: 39.8, lon: 125.75, q: "Yongbyon Nuclear Scientific Research Center", k: "energy" },
                    { t: "Military", n: "Wonsan Naval Base", d: "East Fleet · missile boats", s: "Elevated", c: "ib-deg", lat: 38.65, lon: 128.15, q: "Wonsan Naval Base", k: "macro" }
                ] },
            SAUDI_ARABIA: { flag: "🇸🇦", name: "Saudi Arabia", center: [23.8859, 45.0792], zoom: 5, summary: "Energy exporter shield: Ras Tanura complex + air defense node in Riyadh.",
                assets: [
                    { t: "Energy", n: "Ras Tanura Refinery", d: "550kbpd + export terminal", s: "Operational", c: "ib-op", lat: 26.64, lon: 50.16, q: "Ras Tanura", k: "energy" },
                    { t: "Military", n: "King Salman Air Base", d: "Air defense · Riyadh", s: "Operational", c: "ib-op", lat: 24.71, lon: 46.72, q: "King Salman Air Base", k: "macro" }
                ] },
            CHINA: { flag: "🇨🇳", name: "China", center: [35.8616, 104.1953], zoom: 4, summary: "Strategic expansion: Hainan naval bases + massive port networks.", assets: [] },
            USA: { flag: "🇺🇸", name: "United States", center: [37.0902, -95.7129], zoom: 4, summary: "Global reach: Norfolk fleet + massive aviation hubs.", assets: [] },
            ISRAEL: { flag: "🇮🇱", name: "Israel", center: [31.0460, 34.8516], zoom: 7, summary: "High-density defense: Tel Nof + Haifa port.", assets: [] },
            UK: { flag: "🇬🇧", name: "United Kingdom", center: [55.3780, -3.4359], zoom: 5, summary: "North Atlantic anchor: Faslane sub base + Heathrow.", assets: [] },
            FRANCE: { flag: "🇫🇷", name: "France", center: [46.2276, 2.2137], zoom: 5, summary: "Nuclear power + Mediterranean fleet (Toulon).", assets: [] },
            GERMANY: { flag: "🇩🇪", name: "Germany", center: [51.1656, 10.4515], zoom: 5, summary: "European logistics hub: Ramstein Air Base.", assets: [] },
            INDIA: { flag: "🇮🇳", name: "India", center: [20.5936, 78.9628], zoom: 4, summary: "Indian Ocean watch: Mumbai port + Eastern fleet.", assets: [] },
            PAKISTAN: { flag: "🇵🇰", name: "Pakistan", center: [30.3753, 69.3451], zoom: 5, summary: "Strategic chokepoint: Gwadar Port.", assets: [] },
            SYRIA: { flag: "🇸🇾", name: "Syria", center: [34.8020, 38.9968], zoom: 6, summary: "Conflict zone: Tartus naval facility + Khmeimim.", assets: [] },
            UKRAINE: { flag: "🇺🇦", name: "Ukraine", center: [48.3794, 31.1655], zoom: 5, summary: "Active theater: Odesa port + energy grid.", assets: [] }
        };

        const INFRA_CATS = ['All', 'Aviation', 'Energy', 'Maritime', 'Military'];
        function infraMerged() {
            const seen = new Set(), out = [];
            [...(window._infraDB || []), ...(window._infraStatic || [])].forEach(a => {
                // Handle GeoJSON features or legacy flat objects
                const props = a.properties || a;
                const coords = a.geometry ? a.geometry.coordinates : [a.lon, a.lat];
                const lat = coords[1], lon = coords[0];
                const k = (props.n || '').toLowerCase() + '_' + lat + '_' + lon;
                if (!seen.has(k)) { 
                    seen.add(k); 
                    out.push({
                        t: props.t, n: props.n, d: props.d, s: props.s, c: props.c, lat: lat, lon: lon, q: props.q, k: props.k
                    }); 
                }
            });
            return out;
        }
        function paintInfra() {
            const body = document.getElementById("infraBody");
            const all = infraMerged();
            const counts = {};
            all.forEach(a => counts[a.t] = (counts[a.t] || 0) + 1);
            const tabs = INFRA_CATS.map(t => {
                const n = t === 'All' ? all.length : (counts[t] || 0);
                const on = window._infraFilter === t ? 'border-color:#00ffcc;color:#fff;background:rgba(0,255,204,0.12);' : '';
                return `<span class="infra-chip" style="cursor:pointer;${on}" onclick="window._infraFilter='${t}';paintInfra()"><b>${n}</b> ${t}</span>`;
            }).join('');
            const list = all.filter(a => window._infraFilter === 'All' || a.t === window._infraFilter);
            const rows = list.slice(0, 300).map(a => `<div class="infra-item" onclick="quickScan('${(a.q || a.n).replace(/\\/g, "").replace(/'/g, "").replace(/"/g, "")}', '${a.k || "macro"}', ${a.lat}, ${a.lon})">▪ ${a.n}<br><span style="color:#888;font-size:0.8em;">${a.t} · ${a.d || ""}</span><span class="infra-badge ${a.c || "ib-op"}">${a.s || "Operational"}</span></div>`).join("");
            const sync = (window._infraSync && !(window._infraDB || []).length)
                ? `<div style="color:#888;font-size:0.8em;">⏳ Syncing live DB…</div>`
                : ((window._infraDB || []).length
                    ? `<div style="color:#0f0;font-size:0.8em;">● Live DB merged — ${all.length} total places</div>`
                    : `<div style="color:#888;font-size:0.8em;">Tracked baseline — ${all.length} places</div>`);
            body.innerHTML = `<div style="color:#fff;margin-bottom:4px;">${window._infraSummary || ""}</div><div class="infra-stat">${tabs}</div>${sync}<div style="max-height:420px;overflow-y:auto;">${rows || '<div style="color:#888">No places in this category.</div>'}</div>`;
        }

        async function loadInfraFromDB(c) {
            try {
                const r = await fetch(TRIGGER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get_infra", country: c }) });
                const j = await r.json();
                window._infraSync = false;
                if (j.cached && j.assets && j.assets.length) {
                    window._infraDB = j.assets;
                    paintInfra();
                    logIntel(`${c}: ${j.assets.length} live DB nodes merged${j.stale ? " (stale, refreshing)" : ""}.`, "success");
                } else {
                    paintInfra();
                }
                if (!j.cached || j.stale) fetch(TRIGGER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh_infra", country: c }) });
            } catch (e) {
                window._infraSync = false;
                window._infraDB = [];
                paintInfra();
            }
        }

        function renderInfra(c) {
            const title = document.getElementById("infraTitle");
            if (c === "GLOBAL") {
                title.textContent = "🏗️ Country Infrastructure";
                document.getElementById("infraBody").innerHTML = "Select a country for a professional infrastructure brief.";
                window._infraStatic = []; window._infraDB = [];
                return;
            }
            const m = COUNTRY_INFRA[c] || { flag: "🌐", name: c.replace(/_/g, ' '), center: [20.0, 10.0], zoom: 4, summary: "Dynamic tracking enabled. Live infrastructure sync active.", assets: [] };
            title.textContent = `${m.flag} ${m.name} — Infrastructure`;
            window._infraStatic = m.assets; window._infraDB = [];
            window._infraFilter = window._infraFilter || 'All';
            window._infraSummary = m.summary; window._infraSync = true;
            paintInfra();
            logIntel(`${m.name}: professional brief opened — tracking active.`, "success");
            loadInfraFromDB(c);
        }

        function onCountrySelect() {
            const c = document.getElementById('countrySelect').value;
            if (c === 'GLOBAL') {
                resetView();
                return;
            }
            const items = document.querySelectorAll('.hvt-list li');
            items.forEach(li => {
                li.style.display = (li.getAttribute('data-country') === c) ? 'block' : 'none';
            });
            renderInfra(c);
            const m = COUNTRY_INFRA[c];
            const coords = m ? m.center : [26.8206, 30.8025];
            const z = m ? m.zoom : 5;
            map.flyTo(coords, z, {duration: 2.0});
            document.getElementById('locationSearch').value = c.replace("_", " ");
        }

        async function geocodeLocation(query) {
            logIntel(`Geocoding bounds for: ${query}...`);
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data.length > 0) {
                currentTarget = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: data[0].display_name, bbox: data[0].boundingbox, locked: true };
                const s = parseFloat(currentTarget.bbox[0]), n = parseFloat(currentTarget.bbox[1]);
                const w = parseFloat(currentTarget.bbox[2]), e = parseFloat(currentTarget.bbox[3]);
                map.fitBounds([[s, w], [n, e]], {padding: [20, 20], maxZoom: 12});
                return true;
            } else {
                logIntel(`Location not found.`, "error");
                return false;
            }
        }

        let suggTimer = null, suggItems = [], suggIdx = -1;
        const _suggCache = {}; // Local memory cache to protect API limits
        const searchInput = () => document.getElementById("locationSearch");
        const suggBox = () => document.getElementById("suggestBox");
        document.addEventListener("DOMContentLoaded", () => {
            const inp = searchInput();
            inp.addEventListener("input", () => {
                clearTimeout(suggTimer);
                if (currentTarget) currentTarget.locked = false; // user typed: re-resolve on scan
                const q = inp.value.trim();
                if (q.length < 3) { suggBox().style.display = "none"; return; }
                // Professional Debounce (800ms) to strictly obey Nominatim 1req/sec limit
                suggTimer = setTimeout(() => fetchSuggestions(q), 800);
            });
            inp.addEventListener("keydown", (e) => {
                const box = suggBox();
                if (box.style.display === "none") return;
                if (e.key === "ArrowDown") { e.preventDefault(); suggIdx = Math.min(suggIdx + 1, suggItems.length - 1); paintSugg(); }
                else if (e.key === "ArrowUp") { e.preventDefault(); suggIdx = Math.max(suggIdx - 1, 0); paintSugg(); }
                else if (e.key === "Enter" && suggIdx >= 0 && suggItems[suggIdx]) { e.preventDefault(); pickSugg(suggIdx); }
                else if (e.key === "Escape") { box.style.display = "none"; }
            });
            document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) suggBox().style.display = "none"; });
            logIntel("SYSTEM ONLINE — Global OSINT Engine initialized.", "success");
            logIntel("Select a country or type a target to begin. Live infra syncs every 6h.", "info");
        });
        async function fetchSuggestions(q) {
            try {
                const c = document.getElementById("countrySelect").value;
                const hintMap = { EGYPT: "eg", IRAN: "ir", RUSSIA: "ru", NORTH_KOREA: "kp", SAUDI_ARABIA: "sa", CHINA: "cn", USA: "us", ISRAEL: "il", UK: "gb", FRANCE: "fr", GERMANY: "de", INDIA: "in", PAKISTAN: "pk", SYRIA: "sy", UKRAINE: "ua" };
                const hint = hintMap[c] || "";
                
                const cacheKey = q.toLowerCase() + "_" + hint;
                if (_suggCache[cacheKey]) {
                    suggItems = _suggCache[cacheKey];
                    suggIdx = -1;
                    paintSugg();
                    return;
                }

                const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=en&q=${encodeURIComponent(q)}${hint ? `&countrycodes=${hint}` : ""}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error("API Limit");
                
                suggItems = await res.json();
                _suggCache[cacheKey] = suggItems; // Store to avoid repeating requests
                
                suggIdx = -1;
                paintSugg();
            } catch (err) { suggBox().style.display = "none"; }
        }
        function paintSugg() {
            const box = suggBox();
            if (!suggItems.length) { box.style.display = "none"; return; }
            box.innerHTML = suggItems.map((s, i) => `<div class="${i === suggIdx ? "active" : ""}" data-i="${i}">📍 ${s.display_name.split(",").slice(0, 3).join(",")}</div>`).join("");
            box.style.display = "block";
            box.querySelectorAll("div").forEach(d => d.onclick = () => pickSugg(parseInt(d.dataset.i)));
        }
        function pickSugg(i) {
            const s = suggItems[i];
            if (!s) return;
            searchInput().value = s.display_name.split(",").slice(0, 2).join(",");
            suggBox().style.display = "none";
            currentTarget = { lat: parseFloat(s.lat), lon: parseFloat(s.lon), name: s.display_name, bbox: s.boundingbox || [s.lat - 0.1, s.lat + 0.1, s.lon - 0.1, s.lon + 0.1], locked: true };
            map.flyTo([currentTarget.lat, currentTarget.lon], 11, { duration: 1.5 });
            logIntel(`Suggestion locked: ${s.display_name.split(",")[0]}. Hit MICRO SCAN.`, "success");
        }

        function quickScan(location, type, lat=null, lon=null) {
            document.getElementById('locationSearch').value = location;
            if (lat != null && lon != null && isFinite(lat) && isFinite(lon)) {
                currentTarget = { lat: parseFloat(lat), lon: parseFloat(lon), name: location, bbox: [parseFloat(lat)-0.1, parseFloat(lat)+0.1, parseFloat(lon)-0.1, parseFloat(lon)+0.1], locked: true };
                map.setView([parseFloat(lat), parseFloat(lon)], 14);
            } else {
                // No exact coords: drop any stale lock so executeScan/executeMacroOSINT re-geocode the new query
                currentTarget = null;
            }
            if (type === 'macro') executeMacroOSINT();
            else { document.getElementById('scanFilter').value = type; executeScan(); }
        }

        function generateNodeIntel(type, name, lat, lon) {
            const health = Math.floor(Math.random() * 25) + 75; 
            let status = "Operational", statusClass = "stat-good";
            if (health < 85) { status = "Degraded"; statusClass = "stat-warn"; }
            
            
            const vips = ["Foreign Diplomatic Envoy", "State Official", "Regional Commander", "Corporate Executive", "Logistics Chief"];
            const vipData = (Math.random() > 0.6) ? `<span class="stat-vip">High-Value Target: ${vips[Math.floor(Math.random()*vips.length)]}</span>` : "Routine Activity";
            const milData = (type === "Military Base") ? `<span class="stat-mil">Alert State: Elevated (Exercise/Movement)</span>` : "";
            
            

            return `
                <div class="node-stat" style="color:#00ffcc;">Coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
                <div class="node-stat">System Status: <span class="${statusClass}">${status}</span> (Health: ${health}%)</div>
                <div class="node-stat">VIP / COMINT: ${vipData}</div>
                ${milData ? `<div class="node-stat">${milData}</div>` : ""}
                <button onclick="showInfraProfile('${type}', '${(name||type).replace(/'/g, "")}', ${lat}, ${lon})" style="width:100%; margin-top:8px; background:var(--info); color:#000; font-weight:bold; border:none; padding:6px; cursor:pointer; font-size:10px; border-radius:4px; text-transform:uppercase;">VIEW TACTICAL PROFILE</button>
            `;
        }

        async function executeMacroOSINT() {
            const query = document.getElementById('locationSearch').value.trim();
            const btn = document.getElementById("macroBtn");
            if (!query) return;
            btn.disabled = true;
            clearOverlays();
            
            try {
                // CLICK-LOCK: infra rows / sidebar already carry exact coords — use them directly, never re-geocode past them.
                if (!currentTarget || !currentTarget.locked) {
                    const success = await geocodeLocation(query);
                    if (!success) { btn.disabled = false; return; }
                }
                
                if (!currentTarget || !currentTarget.bbox) {
                    logIntel("Invalid target bounding box. Cannot execute Macro OSINT.", "error");
                    btn.disabled = false;
                    return;
                }

                if (query.toLowerCase().includes("hormuz") || query.toLowerCase().includes("iran")) {
                    logIntel(`CRISIS INTERCEPT: Open-Source News Scraping detected anomalous IRGC Maritime Activity in Sector 4...`, "crisis");
                }

                let s = parseFloat(currentTarget.bbox[0]), n = parseFloat(currentTarget.bbox[1]);
                let w = parseFloat(currentTarget.bbox[2]), e = parseFloat(currentTarget.bbox[3]);
                
                let areaSize = (n - s) * (e - w);
                let nodeQueries = "";
                if (document.getElementById('layer-military').checked) nodeQueries += `nwr["military"](area.searchArea);nwr["landuse"="military"](area.searchArea);`;
                if (document.getElementById('layer-energy').checked) nodeQueries += `nwr["power"~"plant|substation|generator"](area.searchArea);`;
                if (document.getElementById('layer-aviation').checked) nodeQueries += `nwr["aeroway"~"aerodrome|helipad|terminal|runway"](area.searchArea);nwr["military"="airfield"](area.searchArea);`;
                if (document.getElementById('layer-roads').checked) nodeQueries += `way["highway"="motorway"](area.searchArea);`;

                if (nodeQueries === "") { btn.disabled = false; return; }

                logIntel(`[MACRO] Pinging external OpenStreetMap API...`, "info");
                
                let overpassQuery = "";
                if (areaSize > 15) {
                    let radialQueries = "";
                    if (document.getElementById('layer-military').checked) radialQueries += `nwr["military"](around:300000,${currentTarget.lat},${currentTarget.lon});nwr["landuse"="military"](around:300000,${currentTarget.lat},${currentTarget.lon});`;
                    if (document.getElementById('layer-energy').checked) radialQueries += `nwr["power"~"plant|substation|generator"](around:300000,${currentTarget.lat},${currentTarget.lon});`;
                    if (document.getElementById('layer-aviation').checked) radialQueries += `nwr["aeroway"~"aerodrome|helipad|terminal|runway"](around:300000,${currentTarget.lat},${currentTarget.lon});nwr["military"="airfield"](around:300000,${currentTarget.lat},${currentTarget.lon});`;
                    overpassQuery = `[out:json][timeout:25];(${radialQueries});out center 800;`;
                } else {
                    const bboxStr = `${s},${w},${n},${e}`;
                    let bboxQueries = "";
                    if (document.getElementById('layer-military').checked) bboxQueries += `nwr["military"](${bboxStr});nwr["landuse"="military"](${bboxStr});`;
                    if (document.getElementById('layer-energy').checked) bboxQueries += `nwr["power"~"plant|substation|generator"](${bboxStr});`;
                    if (document.getElementById('layer-aviation').checked) bboxQueries += `nwr["aeroway"~"aerodrome|helipad|terminal|runway"](${bboxStr});nwr["military"="airfield"](${bboxStr});`;
                    overpassQuery = `[out:json][timeout:25];(${bboxQueries});out center 800;`;
                }

                try {
                    // Load balance between multiple Overpass mirrors to prevent rate limit bans
                    let osmRes, text;
                    try {
                        osmRes = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: overpassQuery });
                        text = await osmRes.text();
                        if (!osmRes.ok || text.includes("error")) throw new Error("Primary Mirror Overloaded");
                    } catch (primaryErr) {
                        logIntel("[MACRO] Primary Overpass mirror rate-limited. Routing to LZ4 backup...", "warn");
                        osmRes = await fetch("https://lz4.overpass-api.de/api/interpreter", { method: "POST", body: overpassQuery });
                        text = await osmRes.text();
                    }
                    
                    let osmData = null;
                    try { osmData = JSON.parse(text); } catch (parseErr) { throw new Error("API Rate Limit / Invalid JSON"); }
                    if (!osmRes.ok || !osmData.elements || osmData.elements.length === 0) throw new Error("API Rate Limit");
                    let counts = { aviation: 0, energy: 0, military: 0, roads: 0 };
                    
                    osmData.elements.forEach(el => {
                        let lat = el.lat || (el.center && el.center.lat);
                        let lon = el.lon || (el.center && el.center.lon);
                        
                        if (lat && lon) {
                            let color = "#fff", type = "Unknown";
                            if (el.tags && el.tags.aeroway) { color = "#00aaff"; type = "Aviation Hub"; counts.aviation++; }
                            else if (el.tags && el.tags.power) { color = "#ffaa00"; type = "Energy Plant"; counts.energy++; }
                            else if (el.tags && el.tags.military) { color = "#ff0055"; type = "Military Base"; counts.military++; }
                            else return; // Don't draw road nodes individually

                            if (query.toLowerCase().includes("hormuz") && type === "Military Base") color = "#ffea00"; 

                            const popupContent = `<b>${el.tags.name || type}</b>${generateNodeIntel(type, el.tags.name, lat, lon)}`;
                            const marker = L.circleMarker([lat, lon], { 
                                radius: 7, fillColor: color, color: "#000", weight: 2, opacity: 1, fillOpacity: 0.9 
                            }).bindPopup(popupContent).addTo(map);
                            overlays.push(marker);
                        }
                    });
                    logIntel(`[MACRO] NATIONWIDE SCAN COMPLETE. Mapped ${counts.aviation} Aviation Hubs, ${counts.energy} Power Plants, ${counts.military} Military Bases via Live API.`, "success");

                } catch(liveErr) {
                    // FALLBACK TO 12-HOUR CACHE IF BANNED OR TIMEOUT
                    logIntel(`[MACRO] Public API Throttled or Blocked. Activating 12-Hour Local DynamoDB Cache Pipeline...`, "warn");
                    
                    let counts = { aviation: 0, energy: 0, military: 0 };
                    // Prefer our 24h infra DB (hundreds of sites) over the small hardcoded list
                    let cacheSrc = LOCAL_DB_CACHE;
                    try {
                        const cc = document.getElementById('countrySelect').value;
                        if (cc && cc !== 'GLOBAL') {
                            const dbR = await fetch(TRIGGER_URL, { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ action: "get_infra", country: cc }) });
                            const dbJ = await dbR.json();
                            if (dbJ.cached && dbJ.assets && dbJ.assets.length) {
                                const typeMap = { Aviation: "Aviation Hub", Energy: "Energy Plant", Military: "Military Base", Maritime: "Maritime Port" };
                                cacheSrc = dbJ.assets.filter(a => typeMap[a.t]).map(a => ({ lat: a.lat, lon: a.lon, type: typeMap[a.t], name: a.n }));
                                logIntel(`[MACRO] 24h infra DB merged: ${cacheSrc.length} sites for ${cc}.`, "success");
                            }
                        }
                    } catch (dbE) { /* hardcoded cache stays */ }
                    cacheSrc.forEach(el => {
                        if (el.lat >= s && el.lat <= n && el.lat >= s) { // Simplify for regex replacement
                            // Replaced manually inside script block.
                            let allowed = false;
                            if (document.getElementById('layer-military').checked && el.type === "Military Base") allowed = true;
                            if (document.getElementById('layer-energy').checked && el.type === "Energy Plant") allowed = true;
                            if (document.getElementById('layer-aviation').checked && el.type === "Aviation Hub") allowed = true;
                            
                            if (allowed) {
                                let color = "#fff";
                                if (el.type === "Aviation Hub") { color = "#00aaff"; counts.aviation++; }
                                else if (el.type === "Energy Plant") { color = "#ffaa00"; counts.energy++; }
                                else if (el.type === "Military Base") { color = "#ff0055"; counts.military++; }

                                if (query.toLowerCase().includes("hormuz") && el.type === "Military Base") color = "#ffea00"; 

                                const popupContent = `<b>${el.name}</b>${generateNodeIntel(el.type, el.name, el.lat, el.lon)}`;
                                const marker = L.circleMarker([el.lat, el.lon], { 
                                    radius: 7, fillColor: color, color: "#000", weight: 2, opacity: 1, fillOpacity: 0.9 
                                }).bindPopup(popupContent);
                                
                                if (!markerClusters) {
                                    markerClusters = L.markerClusterGroup({
                                        maxClusterRadius: 40,
                                        spiderfyOnMaxZoom: true,
                                        showCoverageOnHover: false,
                                        zoomToBoundsOnClick: true
                                    });
                                    map.addLayer(markerClusters);
                                }
                                markerClusters.addLayer(marker);
                                overlays.push(marker);
                            }
                        }
                    });
                    window.dispatchEvent(new CustomEvent("geoint:osint_update", { detail: { assets: cacheSrc } }));
                    logIntel(`[MACRO] CACHE LOAD COMPLETE. Mapped ${counts.aviation} Aviation Hubs, ${counts.energy} Power Plants, ${counts.military} Military Bases from Offline Storage.`, "success");
                }
            } catch(e) {
                logIntel(`Macro Scan Failed: ${e.message}`, "error");
            } finally {
                btn.disabled = false;
            }
        }

        
        const COUNTRY_TARGETS = {
            'EGYPT': [
                { name: 'Suez Canal', type: 'maritime', label: '🚢 Suez Canal (Chokepoint)', lat: 30.5852, lon: 32.3503 },
                { name: 'Alexandria Port', type: 'maritime', label: '🚢 Alexandria Naval Port', lat: 31.189, lon: 29.870 },
                { name: 'Cairo International Airport', type: 'aviation', label: '✈️ Cairo Airport (Runway)', lat: 30.1219, lon: 31.4056 }
            ],
            'RUSSIA': [
                { name: 'Vladivostok', type: 'maritime', label: '🚢 Vladivostok Pacific Fleet', lat: 43.115, lon: 131.885 },
                { name: 'Sheremetyevo Airport', type: 'aviation', label: '✈️ Sheremetyevo Airport', lat: 55.972, lon: 37.414 }
            ],
            'IRAN': [
                { name: 'Strait of Hormuz', type: 'maritime', label: '🚢 Strait of Hormuz', lat: 26.566, lon: 56.250 }
            ],
            'NORTH KOREA': [
                { name: 'Pyongyang', type: 'aviation', label: '✈️ Pyongyang Airport', lat: 39.224, lon: 125.670 }
            ],
            'SAUDI ARABIA': [
                { name: 'Ras Tanura', type: 'energy', label: '🛢️ Ras Tanura Refinery', lat: 26.640, lon: 50.160 }
            ]
        };

        function showTargetModal(country) {
            const targets = COUNTRY_TARGETS[country] || [];
            const container = document.getElementById('modal-content');
            container.innerHTML = '';
            
            targets.forEach(t => {
                const btn = document.createElement('button');
                btn.style.cssText = "background:rgba(0, 255, 204, 0.1); color:#00ffcc; border:1px solid #00ffcc; padding:10px; cursor:pointer; text-align:left; font-size:0.9em; transition:0.3s;";
                btn.innerHTML = t.label;
                btn.onmouseover = () => { btn.style.background = '#00ffcc'; btn.style.color = '#000'; };
                btn.onmouseout = () => { btn.style.background = 'rgba(0, 255, 204, 0.1)'; btn.style.color = '#00ffcc'; };
                btn.onclick = () => {
                    document.getElementById('targetModal').style.display = 'none';
                    quickScan(t.name, t.type, t.lat, t.lon);
                };
                container.appendChild(btn);
            });
            
            document.getElementById('targetModal').style.display = 'flex';
        }

        async function executeScan() {
            const btn = document.getElementById("scanBtn");
            const filter = document.getElementById("scanFilter").value;
            let query = document.getElementById('locationSearch').value.trim();
            
            let targetLat, targetLon;

            // If the search bar is empty, use the current map center (Optical Targeting)
            if (!query) {
                if (map.getZoom() < 10) {
                    alert("Please zoom in closer (Zoom level 10+) to scan an area directly, or type a location.");
                    return;
                }
                const center = map.getCenter();
                targetLat = center.lat;
                targetLon = center.lng;
                query = `Orbital Lock: ${targetLat.toFixed(4)}, ${targetLon.toFixed(4)}`;
                currentTarget = { lat: targetLat, lon: targetLon, name: query, bbox: [targetLat-0.1, targetLat+0.1, targetLon-0.1, targetLon+0.1], locked: true };
            } else {
                // PREVENT DESERT SCANS: Check if user is trying to Micro Scan an entire country
                const upperQuery = query.toUpperCase();
                const normQuery = upperQuery.replace(/ /g, "_");
                if (COUNTRY_TARGETS[normQuery] || upperQuery === "IRAN / GULF") {
                    let key = upperQuery === "IRAN / GULF" ? "IRAN" : normQuery;
                    showTargetModal(key);
                    return;
                }
                
                // CLICK-LOCK: a place picked from infrastructure/suggestions already carries
                // exact coordinates — photograph it directly, never re-geocode past it.
                if (!currentTarget || !currentTarget.locked) {
                    const success = await geocodeLocation(query);
                    if (!success) { btn.disabled = false; return; }
                }
                if (!currentTarget) {
                    logIntel("Invalid target location. Cannot execute Micro Scan.", "error");
                    btn.disabled = false;
                    return;
                }
                targetLat = currentTarget.lat;
                targetLon = currentTarget.lon;
            }

            btn.disabled = true;
            try {
                logIntel(`[MICRO] Requesting Sentinel-2 orbital imagery... Target: ${query}`);
                clearOverlays();

                const payload = { lat: currentTarget.lat, lon: currentTarget.lon, filter: filter };
                
                if (currentTarget.customBounds) {
                    const w = currentTarget.customBounds.getWest();
                    const e = currentTarget.customBounds.getEast();
                    const s = currentTarget.customBounds.getSouth();
                    const n = currentTarget.customBounds.getNorth();
                    payload.width_deg = Math.abs(e - w);
                    payload.height_deg = Math.abs(n - s);
                    
                    if (payload.width_deg > 2.0 || payload.height_deg > 2.0) {
                        logIntel("[MICRO] WARNING: Frame is massive. Sentinel-2 orbital imagery resolution will be heavily degraded. CV accuracy may drop.", "warn");
                    }
                }

                const startTime = performance.now();
                const res = await fetch(TRIGGER_URL, { headers: { "Content-Type": "application/json" }, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                if (!res.ok) {
                    let errMsg = "HTTP " + res.status;
                    try {
                        const errData = await res.json();
                        errMsg = errData.message || errData.error || errMsg;
                    } catch(e) {
                        const text = await res.text();
                        errMsg += " " + text.substring(0, 40);
                    }
                    throw new Error(errMsg);
                }
                const data = await res.json();
                const endTime = performance.now();
                
                let timeSec = ((endTime - startTime) / 1000).toFixed(1);
                
                if (query.toLowerCase().includes("hormuz") || query.toLowerCase().includes("iran")) {
                    logIntel(`[MICRO] SCAN COMPLETE. Computer Vision intercepted ${data.detections} Anomalous Vessels matching OSINT Crisis Profile!`, "crisis");
                } else {
                    logIntel(`[MICRO] SCAN COMPLETE (${timeSec}s). Target Anomaly Count: ${data.detections}`, "success");
                }

                let secureUrl = data.image_url.replace("http://hossam-cloud-resume-e4b1b23e.s3-website-us-east-1.amazonaws.com", "https://hossam-cloud-resume-e4b1b23e.s3.us-east-1.amazonaws.com");
                
                let scanBounds;
                if (data.bbox && data.bbox.length === 4) {
                    // API returns [minLon, minLat, maxLon, maxLat]
                    const w = data.bbox[0];
                    const s = data.bbox[1];
                    const e = data.bbox[2];
                    const n = data.bbox[3];
                    scanBounds = [[s, w], [n, e]];
                } else {
                    // Fallback to +/- 0.1 deg
                    scanBounds = [
                        [currentTarget.lat - 0.1, currentTarget.lon - 0.1],
                        [currentTarget.lat + 0.1, currentTarget.lon + 0.1]
                    ];
                }

                // Create image overlay matching exact coordinates
                const imgOverlay = L.imageOverlay(secureUrl, scanBounds, {
                    opacity: 0.85,
                    className: 'tactical-overlay-image'
                }).addTo(map);
                overlays.push(imgOverlay);

                // Add tactical boundary box
                const boundsRect = L.rectangle(scanBounds, {
                    color: "#00ffcc",
                    weight: 2,
                    fillOpacity: 0,
                    dashArray: "5, 10"
                }).addTo(map);
                overlays.push(boundsRect);

                // Create a precise tactical marker for info
                const cvMarker = L.circleMarker([currentTarget.lat, currentTarget.lon], { 
                    radius: 8, fillColor: "#ff0055", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9 
                }).addTo(map);
                
                cvMarker.bindPopup(`
                    <div style="width:280px; text-align:center;">
                        <b style="color:#00ffcc; display:block; border-bottom:1px dashed #333; padding-bottom:5px; margin-bottom:8px; font-size:1.1em;">TACTICAL ORBITAL INTERCEPT</b>
                        <div style="color:#ffea00; font-weight:bold; margin-bottom:8px; font-size:1.2em;">${data.detections} ANOMALIES DETECTED</div>
                        <div style="color:#ccc; font-size:0.85em; margin-bottom:8px;">Target Coordinates:<br>${currentTarget.lat.toFixed(4)}, ${currentTarget.lon.toFixed(4)}</div>
                        <a href="${secureUrl}" target="_blank" style="color:#00ffcc; text-decoration:none; border: 1px solid #00ffcc; padding: 4px 8px; display: inline-block; border-radius: 4px;">Enlarge Raw Feed</a>
                        <div style="color:#888; font-size:0.8em; margin-top:8px;">COMPUTER VISION ANALYSIS COMPLETE</div>
                    </div>
                `, {maxWidth: 300}).openPopup();
                
                overlays.push(cvMarker);
                map.fitBounds(scanBounds, {padding: [20, 20]});
            } catch (err) {
                logIntel(`Micro Scan Failed: ${err.message}`, "error");
            } finally {
                btn.disabled = false;
            }
        }

        // --- NEW FEATURES: DOSSIER EXPORT & THREAT FEED ---

        async function exportDossier() {
            const country = document.getElementById('countrySelect');
            const sectorFocus = country.options[country.selectedIndex].text;
            const targetId = country.value;

            logIntel("[DOSSIER] Compiling strategic snapshot to PDF...", "warn");
            const btn = document.getElementById('exportBtn');
            const oldText = btn.innerText;
            btn.innerText = "GENERATING...";
            btn.disabled = true;
            
            try {
                // 1. Gather Aerospace Data
                const planeEntries = Object.entries(activePlanes);
                const activeCount = planeEntries.length;
                let aviationHtml = '<div style="color:var(--text-2); font-size:12px; margin-bottom: 20px;">No active transponders detected in current sector.</div>';
                
                if (activeCount > 0) {
                    aviationHtml = `
                    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; text-align:left;">
                        <thead>
                            <tr style="border-bottom:2px solid var(--border); color:var(--info);">
                                <th style="padding:6px;">CALLSIGN</th>
                                <th style="padding:6px;">HEX</th>
                                <th style="padding:6px;">ALT (m)</th>
                                <th style="padding:6px;">SPD (km/h)</th>
                                <th style="padding:6px;">HDG</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${planeEntries.slice(0, 20).map(([icao, p]) => {
                                const d = p.data;
                                if(!d) return '';
                                return `<tr style="border-bottom:1px solid var(--border);">
                                    <td style="padding:6px; color:var(--text); font-weight:bold;">${d.callsign || 'UNKNOWN'}</td>
                                    <td style="padding:6px; color:var(--text-2);">${icao.toUpperCase()}</td>
                                    <td style="padding:6px; color:var(--warn);">${(d.alt || 0).toFixed(0)}</td>
                                    <td style="padding:6px; color:var(--warn);">${(d.vel * 3.6).toFixed(0)}</td>
                                    <td style="padding:6px; color:var(--success);">${(d.track || 0).toFixed(1)}&deg;</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                    ${activeCount > 20 ? `<div style="font-size:10px; color:var(--text-2); margin-top:-10px; margin-bottom:20px;">+ ${activeCount - 20} additional aircraft truncated for operational brevity.</div>` : ''}
                    `;
                }

                // 2. Gather Infrastructure Data
                let infraBody = document.getElementById('infraBody').innerHTML;
                if (!infraBody || infraBody.includes('Select a country')) {
                    infraBody = '<div style="color:var(--text-2); font-size:12px;">No macro infrastructure intelligence loaded. (Execute MACRO OSINT to populate).</div>';
                }

                // 3. Gather Current Threat Feed
                const marquee = document.getElementById('threat-marquee');
                const threatFeed = marquee ? marquee.innerText : 'NO ACTIVE THREATS';
                
                const element = document.createElement('div');
                element.style.padding = '40px';
                element.style.backgroundColor = '#09090b';
                element.style.color = '#e4e4e7';
                element.style.fontFamily = 'monospace';
                
                element.innerHTML = `
                    <h1 style="color:#00ffcc; border-bottom:2px solid #00ffcc; padding-bottom:10px; font-size: 24px; text-transform: uppercase;">
                        OVERWATCH GEOINT - NATIONAL DOSSIER
                    </h1>
                    <div style="display:flex; justify-content:space-between; margin-bottom:30px; font-size:12px; color:#a1a1aa;">
                        <div><strong>GENERATED:</strong> ${new Date().toISOString()}</div>
                        <div><strong>SECTOR FOCUS:</strong> ${sectorFocus}</div>
                    </div>
                    
                    <h3 style="color:#fbbf24; margin-top:20px; font-size:16px; border-bottom:1px solid #333; padding-bottom:5px;">🚨 ACTIVE THREAT INTELLIGENCE</h3>
                    <div style="background:#131316; padding:15px; border:1px solid #ef4444; border-left:4px solid #ef4444; font-size:11px; margin-bottom:25px; line-height: 1.6; word-wrap: break-word;">
                        ${threatFeed}
                    </div>

                    <h3 style="color:#0ea5e9; margin-top:20px; font-size:16px; border-bottom:1px solid #333; padding-bottom:5px;">✈️ LIVE AEROSPACE TELEMETRY (${activeCount} DETECTED)</h3>
                    ${aviationHtml}

                    <h3 style="color:#10b981; margin-top:20px; font-size:16px; border-bottom:1px solid #333; padding-bottom:5px;">🏗️ STRATEGIC INFRASTRUCTURE PROFILE</h3>
                    <div style="background:#18181b; padding:15px; border:1px solid #27272a; border-radius:6px; font-size:11px;">
                        ${infraBody.replace(/style="/g, 'style="color:#e4e4e7;')}
                    </div>
                    
                    <h3 style="color:#a1a1aa; margin-top:30px; font-size:16px; border-bottom:1px solid #333; padding-bottom:5px;">📋 LATEST OPERATIONAL LOGS</h3>
                    <div style="background:#18181b; padding:15px; border:1px solid #27272a; font-size: 10px;">
                        ${document.getElementById('logs').innerHTML}
                    </div>
                    
                    <div style="margin-top: 40px; text-align: center; color: #71717a; font-size: 10px; border-top: 1px solid #333; padding-top: 10px;">
                        CLASSIFIED DOSSIER - GENERATED BY OVERWATCH GEOINT AUTOMATED INTELLIGENCE SYSTEM
                    </div>
                `;
                
                const opt = {
                    margin:       [0.5, 0.5, 0.5, 0.5],
                    filename:     `Overwatch_${country.value}_Dossier_${new Date().getTime()}.pdf`,
                    image:        { type: 'jpeg', quality: 0.98 },
                    html2canvas:  { scale: 2, backgroundColor: '#09090b', useCORS: true },
                    jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' }
                };
                
                await html2pdf().set(opt).from(element).save();
                
                logIntel("[DOSSIER] National Strategic Dossier successfully exported.", "success");
            } catch(e) {
                logIntel(`[DOSSIER] Export failed: ${e.message}`, "error");
            } finally {
                btn.innerText = oldText;
                btn.disabled = false;
            }
        }

        async function showAirplaneProfile(icao, callsign, alt, vel, track, originCountry, lat, lon) {
            document.getElementById('airplaneModal').style.display = 'block';
            document.getElementById('modalHeaderTitle').innerHTML = '✈️ TACTICAL AIRCRAFT PROFILE';
            const content = document.getElementById('airplaneContent');
            content.innerHTML = `<div style="text-align:center; color:var(--info); font-family:monospace; margin: 20px 0;">Establishing secure SATCOM link to aviation database...<br><span style="font-size:0.8em; color:var(--text-2);">Retrieving visual signature for Hex ${icao.toUpperCase()}</span></div>`;
            
            let photoHtml = `<div style="height:150px; background:#000; border:1px solid #333; display:flex; align-items:center; justify-content:center; color:#555; margin-bottom:15px; border-radius:6px; font-family:monospace; font-size:12px;">NO VISUAL RECORD FOUND IN OPEN-SOURCE DATABASES</div>`;
            
            try {
                // Fetch photo from planespotters API (CORS friendly)
                const res = await fetch(`https://api.planespotters.net/pub/photos/hex/${icao}`);
                const data = await res.json();
                if (data.photos && data.photos.length > 0) {
                    photoHtml = `<div style="margin-bottom:15px; border-radius:6px; overflow:hidden; border:1px solid var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                        <img src="${data.photos[0].thumbnail_large.src}" style="width:100%; display:block;" />
                        <div style="background:#000; color:var(--text-2); font-size:9px; font-family:monospace; padding:4px 8px; text-align:right;">PHOTO IDENTIFICATION MATCH</div>
                    </div>`;
                }
            } catch(e) {}
            
            content.innerHTML = `
                ${photoHtml}
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-family:monospace; font-size:12px;">
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5);">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">CALLSIGN</div>
                        <div style="color:var(--info); font-weight:bold; font-size:16px;">${callsign}</div>
                    </div>
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5);">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">HEX TRANSPONDER</div>
                        <div style="color:var(--text); font-size:16px;">${icao.toUpperCase()}</div>
                    </div>
                    
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5); grid-column:span 2;">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">NATIONAL REGISTRY (ORIGIN)</div>
                        <div style="color:var(--text); font-size:14px; text-transform:uppercase;">${originCountry}</div>
                    </div>
                    
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5); grid-column:span 2; border-left: 3px solid var(--danger);">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">DESTINATION TARGET</div>
                        <div style="color:var(--danger); font-size:12px; font-weight:bold;">[CLASSIFIED / UNAVAILABLE IN RAW TELEMETRY]</div>
                    </div>

                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5);">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">CRUISING ALTITUDE</div>
                        <div style="color:var(--warn); font-size:16px;">${(alt).toFixed(0)} m</div>
                    </div>
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5);">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">TRUE VELOCITY</div>
                        <div style="color:var(--warn); font-size:16px;">${(vel * 3.6).toFixed(0)} km/h</div>
                    </div>
                    
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5); grid-column:span 2; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">GPS COORDINATES (HIGH PRECISION)</div>
                            <div style="color:var(--text); font-size:14px;">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">HEADING</div>
                            <div style="color:var(--success); font-weight:bold; font-size:18px;">${track.toFixed(1)}° <span style="display:inline-block; transform: rotate(${track}deg);">✈</span></div>
                        </div>
                    </div>
                </div>
                <button onclick="document.getElementById('airplaneModal').style.display='none'" style="width:100%; margin-top:15px; background:var(--info); color:#000; border:none; padding:10px; cursor:pointer; font-weight:bold; border-radius:6px; font-family:monospace; letter-spacing:1px;">CLOSE TACTICAL PROFILE</button>
            `;
        }

        async function showInfraProfile(type, name, lat, lon) {
            document.getElementById('airplaneModal').style.display = 'block';
            document.getElementById('modalHeaderTitle').innerHTML = '🏗️ STRATEGIC INFRASTRUCTURE PROFILE';
            const content = document.getElementById('airplaneContent');
            content.innerHTML = `<div style="text-align:center; color:var(--info); font-family:monospace; margin: 20px 0;">Establishing secure SATCOM link to intelligence databases...<br><span style="font-size:0.8em; color:var(--text-2);">Retrieving visual signature for ${name}</span></div>`;
            
            // Generate a 1.2km bounding box around the exact coordinates for pinpoint satellite imaging
            const bboxOffset = 0.006; 
            // Request a perfect 800x800 square from ArcGIS to match the square bounding box, preventing distortion
            const arcgisUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon-bboxOffset},${lat-bboxOffset},${lon+bboxOffset},${lat+bboxOffset}&bboxSR=4326&imageSR=4326&size=800,800&f=image`;
            
            const photoHtml = `<div style="margin-bottom:15px; border-radius:6px; overflow:hidden; border:1px solid var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.5); position:relative;">
                <div style="position:absolute; top:5px; left:5px; background:rgba(0,0,0,0.7); color:var(--danger); font-family:monospace; font-size:10px; padding:2px 6px; border:1px solid var(--danger); z-index:10;">LIVE SATELLITE FEED</div>
                <img src="${arcgisUrl}" style="width:100%; height:220px; object-fit:cover; display:block; filter: contrast(1.1) saturate(1.2);" />
                <div style="position:absolute; bottom:5px; right:5px; background:rgba(0,0,0,0.7); color:#00ffcc; font-family:monospace; font-size:9px; padding:2px 6px; z-index:10; border:1px solid #00ffcc;">GEO-LOCKED: ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
            </div>`;
            
            content.innerHTML = `
                ${photoHtml}
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-family:monospace; font-size:12px;">
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5); grid-column:span 2;">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">TARGET DESIGNATION</div>
                        <div style="color:var(--info); font-weight:bold; font-size:16px; text-transform:uppercase;">${name}</div>
                    </div>
                    
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5);">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">FACILITY TYPE</div>
                        <div style="color:var(--text); font-size:14px; text-transform:uppercase;">${type}</div>
                    </div>
                    
                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5); border-left: 3px solid var(--danger);">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">SECURITY CLEARANCE</div>
                        <div style="color:var(--danger); font-size:12px; font-weight:bold;">[RESTRICTED ZONE]</div>
                    </div>

                    <div style="background:var(--panel); padding:10px; border:1px solid var(--border); border-radius:6px; box-shadow:inset 0 0 10px rgba(0,0,0,0.5); grid-column:span 2;">
                        <div style="color:var(--text-2); font-size:10px; margin-bottom:4px; letter-spacing:1px;">GPS COORDINATES (HIGH PRECISION)</div>
                        <div style="color:var(--text); font-size:16px;">${lat.toFixed(6)}, ${lon.toFixed(6)}</div>
                    </div>
                </div>
                <button onclick="document.getElementById('airplaneModal').style.display='none'" style="width:100%; margin-top:15px; background:var(--info); color:#000; border:none; padding:10px; cursor:pointer; font-weight:bold; border-radius:6px; font-family:monospace; letter-spacing:1px;">CLOSE TACTICAL PROFILE</button>
            `;
        }
        let threatFeedVisible = true;
        function toggleThreatFeed() {
            threatFeedVisible = !threatFeedVisible;
            const ticker = document.getElementById('threat-ticker');
            const toggleBtn = document.getElementById('threat-toggle');
            if (threatFeedVisible) {
                ticker.style.bottom = '0';
                toggleBtn.style.bottom = '26px';
                toggleBtn.innerText = '▼ HIDE THREAT FEED';
                document.getElementById('main').style.height = 'calc(100vh - 96px)';
            } else {
                ticker.style.bottom = '-26px';
                toggleBtn.style.bottom = '0';
                toggleBtn.innerText = '▲ SHOW THREAT FEED';
                document.getElementById('main').style.height = 'calc(100vh - 70px)';
            }
            setTimeout(() => { if (map) map.invalidateSize(); }, 350);
        }

        async function pollThreats() {
            try {
                const res = await fetch(TRIGGER_URL, { headers: { "Content-Type": "application/json" },
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ action: 'get_threats' })
                });
                if (!res.ok) throw new Error("Threat API unresponsive");
                const data = await res.json();
                if (data.status === 'success' && data.threats && data.threats.length > 0) {
                    const countrySel = document.getElementById('countrySelect').value;
                    const mapBounds = map.getBounds();
                    
                    let filteredThreats = data.threats.filter(t => {
                        const match = t.payload.match(/AT\s+([0-9.-]+),\s+([0-9.-]+)/);
                        if (match) {
                            const lat = parseFloat(match[1]);
                            const lon = parseFloat(match[2]);
                            if (map.getZoom() < 5 && countrySel === "GLOBAL") return true;
                            return mapBounds.contains([lat, lon]);
                        }
                        return true; 
                    });
                    
                    const marquee = document.getElementById('threat-marquee');
                    const label = document.getElementById('threat-feed-label');
                    
                    if (filteredThreats.length === 0) {
                        marquee.innerHTML = 'SYSTEM SECURE — NO ANOMALIES DETECTED IN CURRENT SECTOR...';
                        label.innerHTML = `🚨 ${countrySel !== 'GLOBAL' ? 'SECTOR' : 'GLOBAL'} THREAT FEED`;
                        return;
                    }
                    
                    label.innerHTML = `🚨 ${countrySel !== 'GLOBAL' ? 'SECTOR' : 'GLOBAL'} THREAT FEED`;
                    const text = filteredThreats.map(t => {
                        const d = new Date(parseInt(t.timestamp) * 1000);
                        const timeStr = isNaN(d) ? 'LIVE' : d.toISOString().split('T')[1].slice(0,8);
                        
                        let threatType = (t.user_agent || '').replace('OVERWATCH-', '');
                        if (threatType === 'MARITIME') threatType = '🚢 UNIDENTIFIED VESSELS';
                        else if (threatType === 'MILITARY') threatType = '🪖 GROUND ARMOR/INFANTRY';
                        else if (threatType === 'AVIATION') threatType = '✈️ UNAUTHORIZED AEROSPACE';
                        else if (threatType === 'ENERGY') threatType = '⚡ THERMAL ENERGY SIGNATURE';
                        else threatType = '⚠️ TACTICAL ANOMALY';

                        let details = t.payload || 'Unauthorized access attempt';
                        const match = details.match(/^(\d+)\s+ANOMALIES\s+AT\s+([\d.-]+),\s+([\d.-]+)/);
                        if (match) {
                            const count = match[1];
                            const lat = parseFloat(match[2]).toFixed(4);
                            const lon = parseFloat(match[3]).toFixed(4);
                            if (count === "0") {
                                details = `<span style="color:#a1a1aa;">SCAN NEGATIVE</span> at ${lat}°N, ${lon}°E`;
                                threatType = threatType.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '🔎').replace('UNIDENTIFIED', 'CLEAR').replace('UNAUTHORIZED', 'CLEAR').replace('SIGNATURE', 'SCAN');
                            } else {
                                details = `<span style="color:#ef4444; font-weight:900;">${count} DETECTED</span> at ${lat}°N, ${lon}°E`;
                            }
                        }
                        
                        return `<span style="color:var(--info); font-family:monospace;">[${timeStr}]</span> <strong style="color:var(--accent-hi);">${threatType}</strong> — ${details} &nbsp;&nbsp;<span style="color:#52525b; font-size:0.8em;">(SOURCE: ${t.ip ? 'CLASSIFIED-IP' : 'GLOBAL-INTEL'})</span>`;
                    }).join(' &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ');
                    marquee.innerHTML = text;
                }
            } catch (e) {
                console.error("Threat poll error", e);
            }
        }

        setInterval(pollThreats, 30000);
        setTimeout(pollThreats, 2000);
        
        // Refresh threats whenever map moves so bounding-box filter applies dynamically
        map.on('moveend', () => {
            pollThreats();
        });

    

        const driver = window.driver.js.driver;
        const driverObj = driver({
            showProgress: true,
                        steps: [
                {
                    popover: { 
                        title: '🚀 Welcome to Overwatch', 
                        description: 'This dashboard lets you explore global infrastructure and run live computer vision scans. Let\'s take a quick tour.',
                        side: "left", align: 'start'
                    }
                },
                {
                    element: '#countrySelect',
                    popover: { 
                        title: '1. Jump to Region', 
                        description: 'Select a country here to instantly fly the map to a strategic global zone.',
                        side: "bottom", align: 'start'
                    }
                },
                {
                    element: '#macroBtn',
                    popover: { 
                        title: '2. Load Targets', 
                        description: 'Click MACRO OSINT to scan your current view for high-value targets (Ports, Airbases, Military Facilities).',
                        side: "bottom", align: 'start'
                    }
                },
                {
                    element: '#sidebar',
                    popover: { 
                        title: '3. Filter & Lock On', 
                        description: 'Your targets load here. Click a category to filter them, then click any target to lock your camera onto it.',
                        side: "right", align: 'start'
                    }
                },
                {
                    element: '#drawBtn',
                    popover: { 
                        title: '4. Custom Scan Area', 
                        description: 'Want to scan anywhere? Click "Draw Frame", then click and drag on the map to select a custom zone.',
                        side: "top", align: 'start'
                    }
                },
                {
                    element: '#scanFilter',
                    popover: { 
                        title: '5. Choose AI Algorithm', 
                        description: 'Select which computer vision model to use for your scan (Aviation, Maritime, Military Armor).',
                        side: "top", align: 'start'
                    }
                },
                {
                    element: '#scanBtn',
                    popover: { 
                        title: '6. Run the Scan!', 
                        description: 'Click SCAN. Our AWS backend will analyze the satellite feed and highlight detected assets in real-time.',
                        side: "top", align: 'start'
                    }
                },
                {
                    element: '#exportBtn',
                    popover: { 
                        title: '7. Download Report', 
                        description: 'Click DOSSIER to instantly download a tactical intelligence report of your findings.',
                        side: "top", align: 'start'
                    }
                },
                {
                    element: '#radarBtn',
                    popover: { 
                        title: '8. Live Radar', 
                        description: 'Toggle this to overlay real-time global flight transponder data directly onto the map.',
                        side: "top", align: 'start'
                    }
                }
            ]
        });

        // Change the TUTORIAL button to trigger this driver
        function showTutorial() {
            driverObj.drive();
        }


        // Log Visitor Silently
        setTimeout(() => {
            fetch("https://yyp1jlzcjf.execute-api.us-east-1.amazonaws.com/trigger-overwatch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "log_visitor" })
            }).catch(() => {});
        }, 1500);

        // Show tutorial on first load

        window.addEventListener('DOMContentLoaded', () => {
            if (!localStorage.getItem('overwatch_interactive_seen')) {
                setTimeout(() => driverObj.drive(), 500);
                localStorage.setItem('overwatch_interactive_seen', 'true');
            }
        });
    
window.earthquakesLayer = L.layerGroup();
let hasFetchedEarthquakes = false;
window.toggleEarthquakes = async function() {
    const isChecked = document.getElementById('layer-earthquakes').checked;
    
    if (isChecked) {
        window.earthquakesLayer.addTo(window.map);
        logIntel("God's Eye: Fetching live seismic data from USGS...", "info");
        
        if (!hasFetchedEarthquakes) {
            try {
                const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
                const data = await res.json();
                hasFetchedEarthquakes = true;
                window.lastEarthquakesGeoJSON = data;
                
                data.features.forEach(feature => {
                    const coords = feature.geometry.coordinates;
                    const mag = feature.properties.mag;
                    const place = feature.properties.place;
                    
                    L.circleMarker([coords[1], coords[0]], {
                        radius: Math.max(3, mag * 2),
                        fillColor: "#ff3300",
                        color: "#ff0000",
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.6
                    }).bindPopup(`<div style="font-family:monospace;font-size:12px;color:red;"><b>⚠️ M${mag} SEISMIC ANOMALY</b><br>${place}</div>`).addTo(window.earthquakesLayer);
                });
                
                window.dispatchEvent(new CustomEvent("geoint:earthquakes", { detail: data }));
                logIntel(`God's Eye: Tracked ${data.features.length} seismic anomalies worldwide.`, "success");
            } catch(e) {
                logIntel("God's Eye: Failed to fetch seismic data.", "error");
            }
        } else {
            window.dispatchEvent(new CustomEvent("geoint:earthquakes_toggle", { detail: { show: true } }));
        }
    } else {
        window.map.removeLayer(window.earthquakesLayer);
        window.dispatchEvent(new CustomEvent("geoint:earthquakes_toggle", { detail: { show: false } }));
    }
};
