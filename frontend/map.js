async function findRoute() {
    const source = document.getElementById("source").value;
    const destination = document.getElementById("destination").value;
    const mode = document.getElementById("transportMode").value;
    const resultContainer = document.getElementById("routeResult");

    // Check source and destination
    if (!source || !destination) {
        showToast(
            "Please select both start and destination locations.",
            "warning"
        );
        return;
    }

    if (source === destination) {
        showToast(
            "Source and destination cannot be identical.",
            "warning"
        );
        return;
    }

    // Public transport is not supported
    if (mode === "public") {
        showToast(
            "Please select driving, cycling, or walking.",
            "warning"
        );
        return;
    }

    resultContainer.innerHTML =
        "🔄 Calculating optimal real-time route geometry...";

    try {

        // ==========================================
        // CALL FLASK REAL ROUTE API
        // ==========================================

        const url =
            `${API_BASE_URL}/real-route` +
            `?source=${encodeURIComponent(source)}` +
            `&destination=${encodeURIComponent(destination)}` +
            `&mode=${encodeURIComponent(mode)}`;

        const response = await fetch(url);

        const data = await response.json();

        console.log("Real Route API Response:", data);

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Failed to calculate route"
            );
        }


        // ==========================================
        // DRAW ROUTE ON MAP
        // ==========================================

        if (currentRoutePolyline) {
            map.removeLayer(currentRoutePolyline);
        }

        currentRouteCoords = data.geometry
            ? decodePolyline(data.geometry)
            : [];

        if (currentRouteCoords.length > 1) {

            currentRoutePolyline = L.polyline(
                currentRouteCoords,
                {
                    color: "#5638d8",
                    weight: 6,
                    opacity: 0.95
                }
            ).addTo(map);

            map.fitBounds(
                currentRoutePolyline.getBounds(),
                {
                    padding: [30, 30]
                }
            );
        }


        // ==========================================
        // TRANSPORT MODE
        // ==========================================

        const modeIcons = {
            driving: "🚗 Driving",
            cycling: "🚲 Cycling",
            walking: "🚶 Walking"
        };

        const modeName =
            modeIcons[mode] || "🛣️ Route";


        // ==========================================
        // AI SCORE
        // ==========================================

        const aiScoreNumber = Number(data.ai_score);

        const hasAIScore =
            Number.isFinite(aiScoreNumber);

        const aiScore =
            hasAIScore
                ? aiScoreNumber.toFixed(1)
                : "N/A";

        // Keep score between 0 and 100
        const safeScore =
            hasAIScore
                ? Math.max(
                    0,
                    Math.min(
                        100,
                        aiScoreNumber
                    )
                )
                : 0;


        // ==========================================
        // AI CONDITIONS
        // ==========================================

        const conditions =
            data.ai_conditions || {};

        const roadCondition =
            conditions.road_condition || "N/A";

        const trafficLevel =
            conditions.traffic_level || "N/A";

        const weather =
            conditions.weather || "N/A";

        const riskLevel =
            conditions.risk_level || "N/A";


        // ==========================================
        // AI SCORE LABEL
        // ==========================================

        let scoreLabel = "AI Route Score";

        if (hasAIScore) {

            if (aiScoreNumber >= 80) {

                scoreLabel =
                    "Excellent Route";

            } else if (aiScoreNumber >= 60) {

                scoreLabel =
                    "Good Route";

            } else if (aiScoreNumber >= 40) {

                scoreLabel =
                    "Moderate Route";

            } else {

                scoreLabel =
                    "High Risk Route";
            }
        }


        // ==========================================
        // DISPLAY RESULT
        // ==========================================

        resultContainer.innerHTML = `

            <!-- ROUTE RESULT -->

            <div style="
                margin-bottom:15px;
                font-size:16px;
            ">

                <b>
                    ${modeName} Result:
                </b>

                ${data.source}
                →
                ${data.destination}

                &nbsp; | &nbsp;

                📏
                <strong>
                    ${data.distance_km} km
                </strong>

                &nbsp; | &nbsp;

                ⏱️
                <strong>
                    ${data.duration_minutes} mins
                </strong>

            </div>


            <!-- AI CARD -->

            <div style="
                border:1px solid #e2e0f5;
                border-radius:12px;
                padding:18px;
                background:#faf9ff;
                margin-top:10px;
            ">

                <!-- AI HEADER -->

                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                    gap:15px;
                    flex-wrap:wrap;
                    margin-bottom:12px;
                ">

                    <div>

                        <div style="
                            font-size:18px;
                            font-weight:700;
                        ">
                            🤖 AI Route Intelligence
                        </div>

                        <div style="
                            font-size:13px;
                            color:#666;
                            margin-top:4px;
                        ">
                            ${scoreLabel}
                        </div>

                    </div>


                    <!-- SCORE -->

                    <div style="
                        font-size:26px;
                        font-weight:800;
                        color:#5638d8;
                    ">

                        ${aiScore}

                        <span style="
                            font-size:13px;
                            color:#777;
                        ">
                            / 100
                        </span>

                    </div>

                </div>


                <!-- SCORE PROGRESS BAR -->

                <div style="
                    height:10px;
                    background:#e8e8ee;
                    border-radius:10px;
                    overflow:hidden;
                    margin-bottom:18px;
                ">

                    <div style="
                        width:${safeScore}%;
                        height:100%;
                        background:#5638d8;
                        border-radius:10px;
                        transition:width 0.5s ease;
                    ">
                    </div>

                </div>


                <!-- AI CONDITIONS -->

                <div style="
                    display:grid;
                    grid-template-columns:
                    repeat(
                        auto-fit,
                        minmax(140px, 1fr)
                    );
                    gap:12px;
                ">


                    <!-- ROAD -->

                    <div style="
                        padding:10px;
                        border-radius:8px;
                        background:white;
                    ">

                        <small>
                            🛣️ Road Condition
                        </small>

                        <br>

                        <strong>
                            ${roadCondition}
                        </strong>

                    </div>


                    <!-- TRAFFIC -->

                    <div style="
                        padding:10px;
                        border-radius:8px;
                        background:white;
                    ">

                        <small>
                            🚦 Traffic
                        </small>

                        <br>

                        <strong>
                            ${trafficLevel}
                        </strong>

                    </div>


                    <!-- WEATHER -->

                    <div style="
                        padding:10px;
                        border-radius:8px;
                        background:white;
                    ">

                        <small>
                            🌤️ Weather
                        </small>

                        <br>

                        <strong>
                            ${weather}
                        </strong>

                    </div>


                    <!-- RISK -->

                    <div style="
                        padding:10px;
                        border-radius:8px;
                        background:white;
                    ">

                        <small>
                            ⚠️ Risk Level
                        </small>

                        <br>

                        <strong>
                            ${riskLevel}
                        </strong>

                    </div>

                </div>

            </div>
        `;


        // ==========================================
        // UPDATE DASHBOARD METRICS
        // ==========================================

        const metricDistance =
            document.getElementById(
                "metricDistance"
            );

        const metricTime =
            document.getElementById(
                "metricTime"
            );


        if (metricDistance) {

            metricDistance.textContent =
                `${data.distance_km} km`;
        }


        if (metricTime) {

            metricTime.textContent =
                `${Math.round(
                    data.duration_minutes
                )} m`;
        }


        // ==========================================
        // SUCCESS MESSAGE
        // ==========================================

        if (hasAIScore) {

            showToast(
                `Route found! AI score: ${aiScore}/100`,
                "success"
            );

        } else {

            showToast(
                "Route found, but AI score is unavailable.",
                "warning"
            );
        }


    } catch (error) {

        console.error(
            "Find Route Error:",
            error
        );

        resultContainer.innerHTML = `

            <div style="
                padding:10px;
            ">

                ⚠️

                <b>
                    Unable to fetch live route:
                </b>

                ${error.message}

            </div>

        `;

        showToast(
            error.message,
            "warning"
        );
    }
}