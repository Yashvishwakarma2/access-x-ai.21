/* ==========================================
   APP.JS — Integration Bridge
   Connects frontend UI ↔ Flask Backend API
   WITHOUT modifying any existing files.
   ========================================== */

// ==========================================
// API BASE URL
// ==========================================

const API_BASE_URL = "https://access-x-ai21-production.up.railway.app/api";

// ==========================================
// GLOBAL STATE
// ==========================================

let map;
let currentRoutePolyline = null;
let currentRouteCoords = [];
let stopMarkers = [];
let simulationMarker = null;
let simulationRunning = false;
let lastOptimizedStops = null;
let originalStopsOrder = null;

// ==========================================
// POLYLINE DECODER (Google Encoded Polyline)
// ==========================================

function decodePolyline(encoded) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
        lng += dlng;

        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

// ==========================================
// TOAST NOTIFICATION SYSTEM
// ==========================================

function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const icons = {
        success: "✅",
        warning: "⚠️",
        info: "ℹ️",
        error: "❌"
    };

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `${icons[type] || "ℹ️"} ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(20px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 350);
    }, 4000);
}

// ==========================================
// LEAFLET MAP INITIALIZATION
// ==========================================

function initMap() {
    map = L.map("map", {
        center: [25.5, 92.5],
        zoom: 7,
        zoomControl: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18
    }).addTo(map);
}

// ==========================================
// LOAD LOCATIONS INTO DROPDOWNS
// ==========================================

async function loadLocations() {
    try {
        const response = await fetch(`${API_BASE_URL}/locations`);
        const locations = await response.json();

        const sourceSelect = document.getElementById("source");
        const destSelect = document.getElementById("destination");

        if (!sourceSelect || !destSelect) return;

        sourceSelect.innerHTML = '<option value="">Select start location</option>';
        destSelect.innerHTML = '<option value="">Select destination</option>';

        locations.forEach(loc => {
            const opt1 = document.createElement("option");
            opt1.value = loc.name;
            opt1.textContent = `${loc.name}, ${loc.state}`;
            sourceSelect.appendChild(opt1);

            const opt2 = document.createElement("option");
            opt2.value = loc.name;
            opt2.textContent = `${loc.name}, ${loc.state}`;
            destSelect.appendChild(opt2);
        });

        // Add location markers to map
        locations.forEach(loc => {
            L.circleMarker([loc.latitude, loc.longitude], {
                radius: 6,
                fillColor: "#5638d8",
                color: "#fff",
                weight: 2,
                fillOpacity: 0.9
            })
            .bindPopup(`<b>${loc.name}</b><br>${loc.state}`)
            .addTo(map);
        });

    } catch (err) {
        console.error("Failed to load locations:", err);
        showToast("Failed to load locations from server.", "error");
    }
}

// ==========================================
// LOAD STOPS LIST
// ==========================================

async function loadStops() {
    try {
        const response = await fetch(`${API_BASE_URL}/stops`);
        const data = await response.json();

        const assigned = data.assigned || [];
        const unassigned = data.unassigned || [];

        originalStopsOrder = [...assigned];

        renderStopsList(assigned);
        updateStopsCounts(assigned.length, unassigned.length);

        // Add stop markers to map
        clearStopMarkers();
        assigned.forEach((stop, i) => {
            const marker = L.marker([stop.lat, stop.lng], {
                icon: L.divIcon({
                    className: "stop-marker-icon",
                    html: `<div style="background:${stop.type === 'pickup' ? '#3888e8' : '#5638d8'};color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${i + 1}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            })
            .bindPopup(`<b>${stop.name}</b><br>${stop.address}<br>Type: ${stop.type}<br>Window: ${stop.window}`)
            .addTo(map);
            stopMarkers.push(marker);
        });

    } catch (err) {
        console.error("Failed to load stops:", err);
    }
}

function clearStopMarkers() {
    stopMarkers.forEach(m => map.removeLayer(m));
    stopMarkers = [];
}

function renderStopsList(stops) {
    const container = document.getElementById("stopsListContainer");
    if (!container) return;

    container.innerHTML = "";

    stops.forEach((stop, i) => {
        const row = document.createElement("div");
        row.className = "stop-row";
        row.innerHTML = `
            <b class="${stop.type === 'pickup' ? 'pickup-badge' : ''}">${i + 1}</b>
            <div>
                <strong>${stop.name}</strong>
                <span>${stop.address}</span>
            </div>
            <small>${stop.window}<br><strong>ETA:</strong> ${stop.eta || '—'}</small>
            <small>${stop.duration}</small>
            <small><em>${stop.type}</em></small>
            <button class="stop-actions-btn" title="Stop actions">⋮</button>
        `;
        row.addEventListener("click", () => {
            map.setView([stop.lat, stop.lng], 12);
        });
        container.appendChild(row);
    });
}

function updateStopsCounts(assigned, unassigned) {
    const el1 = document.getElementById("stopsCountLabel");
    const el2 = document.getElementById("unassignedCountLabel");
    const metricStops = document.getElementById("metricStops");
    const donutStops = document.getElementById("donutStopsCount");

    if (el1) el1.textContent = assigned;
    if (el2) el2.textContent = unassigned;
    if (metricStops) metricStops.textContent = assigned;
    if (donutStops) donutStops.textContent = assigned;
}

// ==========================================
// LOAD DRIVERS TABLE
// ==========================================

async function loadDrivers() {
    try {
        const response = await fetch(`${API_BASE_URL}/drivers`);
        const drivers = await response.json();

        const table = document.getElementById("driversListTable");
        if (!table) return;

        table.innerHTML = "";
        drivers.forEach(d => {
            const statusClass = d.status === "Active" ? "active" : d.status === "On Route" ? "warning" : "pending";
            table.innerHTML += `
                <tr>
                    <td>${d.id}</td>
                    <td><strong>${d.name}</strong></td>
                    <td>${d.role}</td>
                    <td>${d.vehicle}</td>
                    <td><span class="badge ${statusClass}">${d.status}</span></td>
                    <td>⭐ ${d.rating}</td>
                    <td>${d.assigned_stops}</td>
                </tr>
            `;
        });

        // Also populate dashboard fleet table
        const dashTable = document.getElementById("dashboardFleetTable");
        if (dashTable) {
            dashTable.innerHTML = "";
            drivers.forEach(d => {
                dashTable.innerHTML += `
                    <tr>
                        <td><strong>${d.name}</strong></td>
                        <td>${d.vehicle}</td>
                        <td><span class="badge ${d.status === 'Active' ? 'active' : 'warning'}">${d.status}</span></td>
                        <td>NE India Region</td>
                        <td>Route ${d.id}</td>
                    </tr>
                `;
            });
        }

    } catch (err) {
        console.error("Failed to load drivers:", err);
    }
}

// ==========================================
// LOAD ORDERS TABLE
// ==========================================

async function loadOrders() {
    try {
        const response = await fetch(`${API_BASE_URL}/orders`);
        const orders = await response.json();

        const table = document.getElementById("ordersListTable");
        if (!table) return;

        table.innerHTML = "";
        orders.forEach(o => {
            const prioClass = o.priority === "Urgent" ? "urgent" : o.priority === "High" ? "warning" : "active";
            const statusClass = o.status === "In Transit" ? "active" : o.status === "Loading" ? "warning" : "pending";
            table.innerHTML += `
                <tr>
                    <td><strong>${o.order_id}</strong></td>
                    <td>${o.customer}</td>
                    <td>${o.destination}</td>
                    <td>${o.cargo}</td>
                    <td><span class="badge ${prioClass}">${o.priority}</span></td>
                    <td>${o.eta}</td>
                    <td><span class="badge ${statusClass}">${o.status}</span></td>
                </tr>
            `;
        });

    } catch (err) {
        console.error("Failed to load orders:", err);
    }
}

// ==========================================
// LOAD ALERTS TABLE
// ==========================================

async function loadAlerts() {
    try {
        const response = await fetch(`${API_BASE_URL}/alerts`);
        const alerts = await response.json();

        const table = document.getElementById("alertsListTable");
        if (!table) return;

        table.innerHTML = "";
        alerts.forEach(a => {
            const sevClass = a.severity === "warning" ? "warning" : a.severity === "success" ? "success" : "active";
            table.innerHTML += `
                <tr>
                    <td>${a.id}</td>
                    <td><span class="badge ${sevClass}">${a.severity}</span></td>
                    <td><strong>${a.title}</strong></td>
                    <td>${a.desc}</td>
                    <td>${a.time}</td>
                </tr>
            `;
        });

    } catch (err) {
        console.error("Failed to load alerts:", err);
    }
}

// ==========================================
// LOAD ANALYTICS
// ==========================================

async function loadAnalytics() {
    try {
        const response = await fetch(`${API_BASE_URL}/analytics`);
        const data = await response.json();

        // Update analytics view cards
        const cards = document.querySelectorAll("#view-analytics .card-value");
        if (cards.length >= 4) {
            cards[0].textContent = `${data.total_distance_km.toLocaleString()} km`;
            cards[1].textContent = `${data.co2_reduced_kg} kg`;
            cards[2].textContent = `${data.avg_stop_duration_min} mins`;
            cards[3].textContent = `$${Math.round(data.fuel_saved_liters * 2.96)}`;
        }

        // Update dashboard cards
        const dashCards = document.querySelectorAll("#view-dashboard .card-value");
        if (dashCards.length >= 2) {
            dashCards[1].textContent = data.on_time_rate;
            dashCards[2].textContent = `${data.fuel_saved_liters} L`;
        }

    } catch (err) {
        console.error("Failed to load analytics:", err);
    }
}

// ==========================================
// LOAD WEATHER
// ==========================================

async function loadWeather() {
    try {
        const response = await fetch(`${API_BASE_URL}/weather?location=Guwahati`);
        const data = await response.json();

        const tempEl = document.getElementById("weatherTemp");
        const condEl = document.getElementById("weatherCond");

        if (tempEl) tempEl.textContent = data.temperature;
        if (condEl) condEl.textContent = data.condition;

    } catch (err) {
        console.error("Failed to load weather:", err);
    }
}

// ==========================================
// OPTIMIZE ROUTE (TSP)
// ==========================================

async function optimizeRoute() {
    showToast("Optimizing route sequence with AI...", "info");

    try {
        const response = await fetch(`${API_BASE_URL}/optimize-route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (!data.success) {
            showToast(data.error || "Optimization failed.", "warning");
            return;
        }

        lastOptimizedStops = data.stops;

        // Draw optimized route on map
        if (currentRoutePolyline) {
            map.removeLayer(currentRoutePolyline);
        }

        if (data.geometry) {
            currentRouteCoords = decodePolyline(data.geometry);
            if (currentRouteCoords.length > 1) {
                currentRoutePolyline = L.polyline(currentRouteCoords, {
                    color: "#5638d8",
                    weight: 5,
                    opacity: 0.9,
                    dashArray: null
                }).addTo(map);
                map.fitBounds(currentRoutePolyline.getBounds(), { padding: [30, 30] });
            }
        }

        // Update stops list
        renderStopsList(data.stops);
        clearStopMarkers();
        data.stops.forEach((stop, i) => {
            const marker = L.marker([stop.lat, stop.lng], {
                icon: L.divIcon({
                    className: "stop-marker-icon",
                    html: `<div style="background:${stop.type === 'pickup' ? '#3888e8' : '#5638d8'};color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${i + 1}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            })
            .bindPopup(`<b>${stop.name}</b><br>${stop.address}`)
            .addTo(map);
            stopMarkers.push(marker);
        });

        // Update metrics
        const metricDistance = document.getElementById("metricDistance");
        const metricTime = document.getElementById("metricTime");
        const metricSavings = document.getElementById("metricSavings");
        const metricStops = document.getElementById("metricStops");

        if (metricDistance) metricDistance.textContent = `${data.total_distance_km} km`;
        if (metricTime) {
            const hrs = Math.floor(data.est_time_minutes / 60);
            const mins = Math.round(data.est_time_minutes % 60);
            metricTime.textContent = `${hrs}h ${mins}m`;
        }
        if (metricSavings) metricSavings.textContent = `-${data.time_saved_minutes} min`;
        if (metricStops) metricStops.textContent = data.total_stops;

        // Update footer stats
        const footerStats = document.getElementById("stopsFooterStats");
        if (footerStats) {
            const hrs = Math.floor(data.est_time_minutes / 60);
            const mins = Math.round(data.est_time_minutes % 60);
            footerStats.textContent = `⌁ ${data.total_distance_km} km   ◷ ${hrs}h ${mins}m`;
        }

        // Update route overview legend
        const legDriving = document.getElementById("legDriving");
        const legTotal = document.getElementById("legTotal");
        const legTotalDiff = document.getElementById("legTotalDiff");
        const modalDistSaved = document.getElementById("modalDistSaved");
        const modalTimeSaved = document.getElementById("modalTimeSaved");

        if (legDriving) {
            const hrs = Math.floor((data.est_time_minutes * 0.65) / 60);
            const mins = Math.round((data.est_time_minutes * 0.65) % 60);
            legDriving.textContent = `${hrs}h ${mins}m`;
        }
        if (legTotal) {
            const hrs = Math.floor(data.est_time_minutes / 60);
            const mins = Math.round(data.est_time_minutes % 60);
            legTotal.textContent = `${hrs}h ${mins}m`;
        }
        if (legTotalDiff) legTotalDiff.textContent = `-${data.time_saved_minutes}m`;
        if (modalDistSaved) modalDistSaved.textContent = `${data.distance_saved_km} km`;
        if (modalTimeSaved) modalTimeSaved.textContent = `${data.time_saved_minutes} mins`;

        // Update notice text
        const noticeText = document.getElementById("noticeText");
        if (noticeText) {
            noticeText.textContent = `Route optimized: ${data.total_stops} stops, ${data.total_distance_km} km total. Saved ${data.distance_saved_km} km and ${data.time_saved_minutes} mins.`;
        }

        showToast(`Route optimized! Saved ${data.time_saved_minutes} min and ${data.distance_saved_km} km.`, "success");

    } catch (err) {
        console.error("Optimize route error:", err);
        showToast("Failed to optimize route: " + err.message, "error");
    }
}

// ==========================================
// POPULATE ROUTES TABLE
// ==========================================

function populateRoutesTable() {
    const table = document.getElementById("routesListTable");
    if (!table) return;

    const routes = [
        { id: "RT-001", driver: "Alex Morgan", route: "Guwahati → Kohima", dist: "486 km", time: "9h 40m", status: "Active" },
        { id: "RT-002", driver: "Rahul Sharma", route: "Shillong → Imphal", dist: "480 km", time: "12h 00m", status: "In Transit" },
        { id: "RT-003", driver: "Priya Singh", route: "Guwahati → Silchar", dist: "235 km", time: "6h 00m", status: "Scheduled" }
    ];

    table.innerHTML = "";
    routes.forEach(r => {
        const statusClass = r.status === "Active" ? "active" : r.status === "In Transit" ? "warning" : "pending";
        table.innerHTML += `
            <tr>
                <td><strong>${r.id}</strong></td>
                <td>${r.driver}</td>
                <td>${r.route}</td>
                <td>${r.dist}</td>
                <td>${r.time}</td>
                <td><span class="badge ${statusClass}">${r.status}</span></td>
            </tr>
        `;
    });
}

// ==========================================
// POPULATE ALL STOPS MASTER TABLE
// ==========================================

async function populateAllStopsTable() {
    try {
        const response = await fetch(`${API_BASE_URL}/stops`);
        const data = await response.json();

        const table = document.getElementById("allStopsMasterTable");
        if (!table) return;

        const allStops = [...(data.assigned || []), ...(data.unassigned || [])];
        table.innerHTML = "";
        allStops.forEach(s => {
            const typeClass = s.type === "pickup" ? "active" : "warning";
            const statusClass = s.status === "pending" ? "pending" : "active";
            table.innerHTML += `
                <tr>
                    <td><strong>${s.name}</strong></td>
                    <td>${s.address}</td>
                    <td><span class="badge ${typeClass}">${s.type}</span></td>
                    <td>${s.window}</td>
                    <td>${s.eta || '—'}</td>
                    <td>${s.duration}</td>
                    <td><span class="badge ${statusClass}">${s.status || 'unassigned'}</span></td>
                </tr>
            `;
        });
    } catch (err) {
        console.error("Failed to load all stops:", err);
    }
}

// ==========================================
// VIEW CHANGES MODAL — OPTIMIZATION DETAILS
// ==========================================

function populateOptChangesTable() {
    const tbody = document.getElementById("optChangesTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    const orig = originalStopsOrder || [];
    const opt = lastOptimizedStops || [];
    const maxLen = Math.max(orig.length, opt.length);

    for (let i = 0; i < maxLen; i++) {
        const origName = orig[i] ? orig[i].name : "—";
        const optName = opt[i] ? opt[i].name : "—";
        const changed = origName !== optName;
        tbody.innerHTML += `
            <tr>
                <td>${i + 1}</td>
                <td>${origName}</td>
                <td style="${changed ? 'color:#5638d8;font-weight:700;' : ''}">${optName}</td>
                <td>${changed ? '<span style="color:#2d9b68;">↻ Moved</span>' : '—'}</td>
            </tr>
        `;
    }
}

// ==========================================
// ADD STOP
// ==========================================

async function addNewStop() {
    const name = document.getElementById("newStopName").value.trim();
    const address = document.getElementById("newStopAddress").value.trim();
    const type = document.getElementById("newStopType").value;
    const window = document.getElementById("newStopWindow").value;
    const duration = document.getElementById("newStopDuration").value;

    if (!name) {
        showToast("Please enter a location name.", "warning");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/stops`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, address, type, window, duration })
        });

        const data = await response.json();
        if (data.success) {
            showToast(`Stop "${name}" added successfully!`, "success");
            closeModal("addStopModal");
            loadStops();
        } else {
            showToast("Failed to add stop.", "warning");
        }
    } catch (err) {
        console.error("Add stop error:", err);
        showToast("Error adding stop: " + err.message, "error");
    }
}

// ==========================================
// MODAL HELPERS
// ==========================================

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("active");
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove("active");
}

// ==========================================
// EXPORT FUNCTIONS
// ==========================================

function exportRouteJSON() {
    const data = {
        stops: lastOptimizedStops || originalStopsOrder || [],
        exportedAt: new Date().toISOString(),
        source: "Routa Smart Logistics"
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "route_export.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Route exported as JSON.", "success");
}

function exportManifestCSV() {
    const stops = lastOptimizedStops || originalStopsOrder || [];
    if (!stops.length) {
        showToast("No stops to export.", "warning");
        return;
    }
    let csv = "Seq,Name,Address,Type,Window,ETA,Duration\n";
    stops.forEach((s, i) => {
        csv += `${i + 1},"${s.name}","${s.address}",${s.type},"${s.window}",${s.eta || ''},${s.duration}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "route_manifest.csv";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Manifest exported as CSV.", "success");
}

function printManifest() {
    window.print();
    showToast("Print dialog opened.", "info");
}

// ==========================================
// DRIVER TRACKING SIMULATION
// ==========================================

function simulateDriverTracking() {
    if (!currentRouteCoords || currentRouteCoords.length < 2) {
        showToast("No route on map to simulate. Find a route or optimize first.", "warning");
        return;
    }

    if (simulationRunning) {
        showToast("Simulation already running.", "info");
        return;
    }

    simulationRunning = true;
    showToast("Driver tracking simulation started...", "info");

    if (simulationMarker) {
        map.removeLayer(simulationMarker);
    }

    const truckIcon = L.divIcon({
        className: "sim-truck-icon",
        html: '<div style="background:#5638d8;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.4);">🚛</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    simulationMarker = L.marker(currentRouteCoords[0], { icon: truckIcon }).addTo(map);

    let step = 0;
    const interval = setInterval(() => {
        step++;
        if (step >= currentRouteCoords.length) {
            clearInterval(interval);
            simulationRunning = false;
            showToast("Simulation complete — driver arrived at destination.", "success");
            return;
        }
        simulationMarker.setLatLng(currentRouteCoords[step]);
        map.panTo(currentRouteCoords[step], { animate: true, duration: 0.3 });
    }, 150);
}

// ==========================================
// NAVIGATION — VIEW SWITCHING
// ==========================================

function setupNavigation() {
    const navLinks = document.querySelectorAll(".nav-link");
    const viewPanels = document.querySelectorAll(".view-panel");
    const pageTitle = document.getElementById("pageTitle");
    const pageSubTitle = document.getElementById("pageSubTitle");

    const titles = {
        dashboard: "Dashboard",
        optimizer: "Route Optimizer",
        routes: "Routes",
        drivers: "Drivers",
        orders: "Orders",
        stops: "Stops Management",
        alerts: "Alerts & Notifications",
        analytics: "Analytics",
        settings: "Settings"
    };

    navLinks.forEach(link => {
        link.addEventListener("click", (e) => {
            const view = link.dataset.view;
            const panel = document.getElementById(`view-${view}`);

            // On separate HTML pages, allow normal browser navigation.
            if (!panel) return;

            e.preventDefault();

            // Toggle active nav
            navLinks.forEach(l => l.classList.remove("active"));
            link.classList.add("active");

            // Toggle active panel
            viewPanels.forEach(p => p.classList.remove("active"));
            panel.classList.add("active");

            // Update page title
            if (pageTitle) pageTitle.textContent = titles[view] || view;

            // Load data for specific views
            if (view === "drivers") loadDrivers();
            if (view === "orders") loadOrders();
            if (view === "alerts") loadAlerts();
            if (view === "analytics") loadAnalytics();
            if (view === "stops") populateAllStopsTable();
            if (view === "routes") populateRoutesTable();
            if (view === "optimizer" && map) {
                setTimeout(() => map.invalidateSize(), 100);
            }
        });
    });
}

// ==========================================
// SWAP SOURCE ↔ DESTINATION
// ==========================================

function swapLocations() {
    const source = document.getElementById("source");
    const dest = document.getElementById("destination");
    if (source && dest) {
        const temp = source.value;
        source.value = dest.value;
        dest.value = temp;
        showToast("Start and destination swapped.", "info");
    }
}

// ==========================================
// MAP THEME SETTINGS
// ==========================================

function applyMapTheme(theme) {
    if (!map) return;

    // Remove existing tile layer
    map.eachLayer(layer => {
        if (layer instanceof L.TileLayer) {
            map.removeLayer(layer);
        }
    });

    const tiles = {
        osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    };

    L.tileLayer(tiles[theme] || tiles.osm, {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);
}

// ==========================================
// WIRE UP ALL EVENT LISTENERS
// ==========================================

function setupEventListeners() {
    // Find Route button
    const findRouteBtn = document.getElementById("findRoute");
    if (findRouteBtn) {
        findRouteBtn.addEventListener("click", findRoute);
    }

    // Optimize Route buttons
    const topOptimize = document.getElementById("topOptimize");
    if (topOptimize) {
        topOptimize.addEventListener("click", optimizeRoute);
    }

    // Swap locations
    const swapBtn = document.getElementById("swapLocationsBtn");
    if (swapBtn) {
        swapBtn.addEventListener("click", swapLocations);
    }

    // Add Stop modal
    const addStopBtn = document.getElementById("addStopBtn");
    if (addStopBtn) {
        addStopBtn.addEventListener("click", () => openModal("addStopModal"));
    }

    const closeAddStop = document.getElementById("closeAddStopModal");
    if (closeAddStop) {
        closeAddStop.addEventListener("click", () => closeModal("addStopModal"));
    }

    const cancelAddStop = document.getElementById("cancelAddStopModal");
    if (cancelAddStop) {
        cancelAddStop.addEventListener("click", () => closeModal("addStopModal"));
    }

    const saveNewStop = document.getElementById("saveNewStopBtn");
    if (saveNewStop) {
        saveNewStop.addEventListener("click", addNewStop);
    }

    // More Actions dropdown
    const moreBtn = document.getElementById("moreActionsBtn");
    const moreMenu = document.getElementById("moreActionsMenu");
    if (moreBtn && moreMenu) {
        moreBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            moreMenu.classList.toggle("active");
        });
        document.addEventListener("click", () => {
            moreMenu.classList.remove("active");
        });
    }

    // More Actions items
    const menuExportJson = document.getElementById("menuExportJson");
    if (menuExportJson) menuExportJson.addEventListener("click", exportRouteJSON);

    const menuExportCsv = document.getElementById("menuExportCsv");
    if (menuExportCsv) menuExportCsv.addEventListener("click", exportManifestCSV);

    const menuPrint = document.getElementById("menuPrint");
    if (menuPrint) menuPrint.addEventListener("click", printManifest);

    const menuSimulate = document.getElementById("menuSimulate");
    if (menuSimulate) menuSimulate.addEventListener("click", simulateDriverTracking);

    const menuReset = document.getElementById("menuReset");
    if (menuReset) {
        menuReset.addEventListener("click", () => {
            loadStops();
            if (currentRoutePolyline) {
                map.removeLayer(currentRoutePolyline);
                currentRoutePolyline = null;
            }
            currentRouteCoords = [];
            showToast("Route reset to defaults.", "info");
        });
    }

    // Toolbar simulate button
    const toolbarSim = document.getElementById("toolbarSimulateBtn");
    if (toolbarSim) {
        toolbarSim.addEventListener("click", simulateDriverTracking);
    }

    // View Changes modal
    const viewChangesBtn = document.getElementById("viewChangesBtn");
    if (viewChangesBtn) {
        viewChangesBtn.addEventListener("click", (e) => {
            e.preventDefault();
            populateOptChangesTable();
            openModal("viewChangesModal");
        });
    }

    const closeViewChanges = document.getElementById("closeViewChangesModal");
    if (closeViewChanges) {
        closeViewChanges.addEventListener("click", () => closeModal("viewChangesModal"));
    }

    const closeViewChangesBtn = document.getElementById("closeViewChangesModalBtn");
    if (closeViewChangesBtn) {
        closeViewChangesBtn.addEventListener("click", () => closeModal("viewChangesModal"));
    }

    // Overview compare button
    const overviewCompare = document.getElementById("overviewCompareBtn");
    if (overviewCompare) {
        overviewCompare.addEventListener("click", (e) => {
            e.preventDefault();
            populateOptChangesTable();
            openModal("viewChangesModal");
        });
    }

    // Stops tabs
    const tabStops = document.getElementById("tabStopsBtn");
    const tabUnassigned = document.getElementById("tabUnassignedBtn");
    if (tabStops && tabUnassigned) {
        tabStops.addEventListener("click", () => {
            tabStops.classList.add("selected");
            tabUnassigned.classList.remove("selected");
            loadStops();
        });

        tabUnassigned.addEventListener("click", async () => {
            tabUnassigned.classList.add("selected");
            tabStops.classList.remove("selected");
            try {
                const response = await fetch(`${API_BASE_URL}/stops`);
                const data = await response.json();
                renderStopsList(data.unassigned || []);
            } catch (err) {
                console.error("Failed to load unassigned stops:", err);
            }
        });
    }

    // Expand stops
    const expandStops = document.getElementById("expandStopsBtn");
    if (expandStops) {
        expandStops.addEventListener("click", (e) => {
            e.preventDefault();
            // Navigate to stops view
            const stopsNav = document.querySelector('[data-view="stops"]');
            if (stopsNav) stopsNav.click();
        });
    }

    // Save settings
    const saveSettings = document.getElementById("saveSettingsBtn");
    if (saveSettings) {
        saveSettings.addEventListener("click", () => {
            const theme = document.getElementById("settingMapTheme").value;
            applyMapTheme(theme);
            showToast("Preferences saved.", "success");
        });
    }

    // Traffic toggle
    const trafficToggle = document.getElementById("trafficToggle");
    if (trafficToggle) {
        trafficToggle.addEventListener("change", () => {
            const badge = document.getElementById("liveTrafficBadge");
            if (badge) {
                badge.style.opacity = trafficToggle.checked ? "1" : "0.4";
            }
            showToast(trafficToggle.checked ? "Live traffic overlay enabled." : "Live traffic overlay disabled.", "info");
        });
    }

    // Weather button
    const weatherBtn = document.getElementById("weatherBtn");
    if (weatherBtn) {
        weatherBtn.addEventListener("click", () => {
            showToast("Weather: 18°C, Light rain. Humidity: 78%. Drive safely!", "info");
        });
    }

    // User profile button
    const userProfile = document.getElementById("userProfileBtn");
    if (userProfile) {
        userProfile.addEventListener("click", () => {
            showToast("Profile: Alex Morgan — Dispatcher, NE Region.", "info");
        });
    }

    // Filter stops button
    const filterStops = document.getElementById("filterStopsBtn");
    if (filterStops) {
        filterStops.addEventListener("click", () => {
            showToast("Filter panel coming soon!", "info");
        });
    }
}

// ==========================================
// INITIALIZE APPLICATION
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 Routa Smart Logistics — Initializing...");

    // 1. Initialize the Leaflet map
    initMap();

    // 2. Setup navigation and events
    setupNavigation();
    setupEventListeners();

    // 3. Load initial data from backend
    await loadLocations();
    await loadStops();
    loadWeather();
    populateRoutesTable();

    console.log("✅ Routa Smart Logistics — Ready!");
    showToast("System initialized. Backend connected.", "success");
});