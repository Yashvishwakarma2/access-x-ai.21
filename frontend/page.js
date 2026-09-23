const API_BASE_URL = "https://access-x-ai21-production.up.railway.app/api";

function setActiveNav() {
    const current = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link').forEach(link => {
        const href = link.getAttribute('href');
        link.classList.toggle('active', href === current || (current === '' && href === 'index.html'));
    });
}

async function getJSON(endpoint) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
}

function setRows(id, html) {
    const tbody = document.getElementById(id);
    if (tbody) tbody.innerHTML = html;
}

async function loadDriversPage() {
    try {
        const drivers = await getJSON('/drivers');
        setRows('driversListTable', drivers.map(d => `
            <tr>
                <td><strong>${d.id}</strong></td><td>${d.name}</td><td>${d.role}</td>
                <td>${d.vehicle}</td><td><span class="badge ${d.status === 'Active' ? 'active' : 'pending'}">${d.status}</span></td>
                <td>⭐ ${d.rating}</td><td>${d.assigned_stops}</td>
            </tr>`).join(''));
    } catch (e) { setRows('driversListTable', `<tr><td colspan="7">Unable to load drivers. Start the Flask server.</td></tr>`); }
}

async function loadOrdersPage() {
    try {
        const orders = await getJSON('/orders');
        setRows('ordersListTable', orders.map(o => `
            <tr>
                <td><strong>${o.order_id}</strong></td><td>${o.customer}</td><td>${o.destination}</td>
                <td>${o.cargo}</td><td><span class="badge ${o.priority === 'Urgent' ? 'urgent' : 'pending'}">${o.priority}</span></td>
                <td>${o.eta}</td><td><span class="badge success">${o.status}</span></td>
            </tr>`).join(''));
    } catch (e) { setRows('ordersListTable', `<tr><td colspan="7">Unable to load orders. Start the Flask server.</td></tr>`); }
}

async function loadAlertsPage() {
    try {
        const alerts = await getJSON('/alerts');
        setRows('alertsListTable', alerts.map(a => `
            <tr>
                <td><strong>${a.id}</strong></td><td><span class="badge ${a.severity}">${a.severity.toUpperCase()}</span></td>
                <td><strong>${a.title}</strong></td><td>${a.desc}</td><td>${a.time}</td>
            </tr>`).join(''));
    } catch (e) { setRows('alertsListTable', `<tr><td colspan="5">Unable to load alerts. Start the Flask server.</td></tr>`); }
}

async function loadStopsPage() {
    try {
        const data = await getJSON('/stops');
        const stops = [...(data.assigned || []), ...(data.unassigned || [])];
        setRows('allStopsMasterTable', stops.map(s => `
            <tr>
                <td><strong>${s.name}</strong></td><td>${s.address}</td><td>${s.type}</td>
                <td>${s.window}</td><td>${s.eta || '-'}</td><td>${s.duration}</td>
                <td><span class="badge pending">${s.status || 'pending'}</span></td>
            </tr>`).join(''));
    } catch (e) { setRows('allStopsMasterTable', `<tr><td colspan="7">Unable to load stops. Start the Flask server.</td></tr>`); }
}

async function loadRoutesPage() {
    try {
        const roads = await getJSON('/roads');
        setRows('routesListTable', roads.map((r, i) => `
            <tr>
                <td><strong>${r.road_id}</strong></td><td>Driver ${String((i % 3) + 1).padStart(2, '0')}</td>
                <td>${r.source} → ${r.destination}</td><td>${r.distance_km} km</td>
                <td>${r.normal_travel_time_hr} hr</td><td><span class="badge active">Available</span></td>
            </tr>`).join(''));
    } catch (e) { setRows('routesListTable', `<tr><td colspan="6">Unable to load routes. Start the Flask server.</td></tr>`); }
}

async function loadDashboardPage() {
    try {
        const [drivers, orders, analytics] = await Promise.all([
            getJSON('/drivers'), getJSON('/orders'), getJSON('/analytics')
        ]);
        const active = drivers.filter(d => d.status === 'Active' || d.status === 'On Route').length;
        document.getElementById('activeDriversValue').textContent = `${active} / ${drivers.length}`;
        document.getElementById('onTimeValue').textContent = analytics.on_time_rate;
        document.getElementById('fuelSavedValue').textContent = `${analytics.fuel_saved_liters} L`;
        document.getElementById('pendingOrdersValue').textContent = orders.filter(o => o.status !== 'In Transit').length;
        setRows('dashboardFleetTable', drivers.map(d => `
            <tr><td><strong>${d.name}</strong></td><td>${d.vehicle}</td>
            <td><span class="badge ${d.status === 'Active' ? 'active' : 'pending'}">${d.status}</span></td>
            <td>North Eastern Region</td><td>${d.assigned_stops} stops</td></tr>`).join(''));
    } catch (e) {
        setRows('dashboardFleetTable', `<tr><td colspan="5">Unable to load dashboard data. Start the Flask server.</td></tr>`);
    }
}

async function loadAnalyticsPage() {
    try {
        const a = await getJSON('/analytics');
        document.getElementById('analyticsDistance').textContent = `${a.total_distance_km} km`;
        document.getElementById('analyticsCo2').textContent = `${a.co2_reduced_kg} kg`;
        document.getElementById('analyticsStop').textContent = `${a.avg_stop_duration_min} min`;
        document.getElementById('analyticsFuel').textContent = `${a.fuel_saved_liters} L`;
        document.getElementById('analyticsOnTime').textContent = a.on_time_rate;
    } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
    setActiveNav();
    const page = document.body.dataset.page;
    if (page === 'dashboard') loadDashboardPage();
    if (page === 'routes') loadRoutesPage();
    if (page === 'drivers') loadDriversPage();
    if (page === 'orders') loadOrdersPage();
    if (page === 'stops') loadStopsPage();
    if (page === 'alerts') loadAlertsPage();
    if (page === 'analytics') loadAnalyticsPage();
});
