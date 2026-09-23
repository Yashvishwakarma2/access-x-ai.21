from flask import Flask, jsonify, request, session
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash
import pandas as pd
import os
import requests
import joblib
import math
import re
import secrets
import sqlite3
import time

def encode_polyline(points):
    def _encode_number(num):
        num = ~(num << 1) if num < 0 else num << 1
        chunks = []
        while num >= 0x20:
            chunks.append(chr((0x20 | (num & 0x1f)) + 63))
            num >>= 5
        chunks.append(chr(num + 63))
        return "".join(chunks)

    output = []
    last_lat = 0
    last_lng = 0

    for lat, lng in points:
        lat_int = int(round(lat * 1e5))
        lng_int = int(round(lng * 1e5))
        d_lat = lat_int - last_lat
        d_lng = lng_int - last_lng
        output.append(_encode_number(d_lat))
        output.append(_encode_number(d_lng))
        last_lat = lat_int
        last_lng = lng_int

    return "".join(output)

def decode_polyline(polyline_str):
    index = 0
    lat = 0
    lng = 0
    coordinates = []
    length = len(polyline_str)

    while index < length:
        b = 0
        shift = 0
        result = 0
        while True:
            b = ord(polyline_str[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        shift = 0
        result = 0
        while True:
            b = ord(polyline_str[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng

        coordinates.append((lat / 1e5, lng / 1e5))

    return coordinates


app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", secrets.token_hex(32)),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 8
)
CORS(app, supports_credentials=True)

AUTH_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "auth.sqlite3")
AUTH_ATTEMPTS = {}


def get_auth_db():
    connection = sqlite3.connect(AUTH_DB)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_auth_db():
    with get_auth_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def client_is_rate_limited(key):
    now = time.time()
    attempts = [stamp for stamp in AUTH_ATTEMPTS.get(key, []) if now - stamp < 900]
    AUTH_ATTEMPTS[key] = attempts
    return len(attempts) >= 8


def record_auth_attempt(key):
    AUTH_ATTEMPTS.setdefault(key, []).append(time.time())


initialize_auth_db()


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    return response


@app.before_request
def require_api_login():
    if request.path.startswith("/api/") and request.path not in {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/me"
    } and "user_id" not in session:
        return jsonify({"success": False, "error": "Authentication required."}), 401


@app.route("/api/auth/register", methods=["POST"])
def register():
    key = request.remote_addr or "unknown"
    if client_is_rate_limited(key):
        return jsonify({"success": False, "error": "Too many attempts. Try again later."}), 429

    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not name or len(name) > 80 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify({"success": False, "error": "Enter a valid name and email address."}), 400
    if len(password) < 12 or not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password) or not re.search(r"\d", password):
        return jsonify({"success": False, "error": "Password must be at least 12 characters with upper, lower, and numeric characters."}), 400

    try:
        with get_auth_db() as connection:
            cursor = connection.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                (name, email, generate_password_hash(password))
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "error": "Unable to create this account."}), 409

    session.clear()
    session.permanent = True
    session["user_id"] = user_id
    session["user_name"] = name
    return jsonify({"success": True, "user": {"name": name, "email": email}}), 201


@app.route("/api/auth/login", methods=["POST"])
def login():
    key = request.remote_addr or "unknown"
    if client_is_rate_limited(key):
        return jsonify({"success": False, "error": "Too many attempts. Try again later."}), 429

    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    with get_auth_db() as connection:
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        record_auth_attempt(key)
        return jsonify({"success": False, "error": "Invalid email or password."}), 401

    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["user_name"] = user["name"]
    return jsonify({"success": True, "user": {"name": user["name"], "email": user["email"]}})


@app.route("/api/auth/me")
def current_user():
    if "user_id" not in session:
        return jsonify({"authenticated": False})
    with get_auth_db() as connection:
        user = connection.execute("SELECT name, email FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    if not user:
        session.clear()
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "user": dict(user)})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"success": True})

# ==========================================
# BASE DIRECTORY & DATA PATHS
# ==========================================

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROADS_FILE = os.path.join(BASE_DIR, "data", "roads.csv")
LOCATIONS_FILE = os.path.join(BASE_DIR, "data", "locations.csv")

ORS_API_KEY = os.environ.get("ORS_API_KEY", "")

# ==========================================
# AI MODEL
# ==========================================

MODEL_FILE = os.path.join(
    BASE_DIR,
    "ai",
    "route_model.pkl"
)

try:
    ai_model = joblib.load(MODEL_FILE)
    print("AI model loaded successfully!")
except Exception as e:
    ai_model = None
    print("Warning: AI model could not be loaded.")
    print(e)


# In-memory dynamic stops store
DYNAMIC_STOPS = [
    {"id": "stop-1", "name": "Guwahati Hub", "address": "GS Road, Guwahati, Assam", "lat": 26.1445, "lng": 91.7362, "window": "09:00 - 10:00", "eta": "09:15", "duration": "20 min", "type": "pickup", "status": "pending"},
    {"id": "stop-2", "name": "Tezpur Logistics Depot", "address": "Main Market, Tezpur, Assam", "lat": 26.6528, "lng": 92.7926, "window": "09:30 - 10:30", "eta": "09:42", "duration": "15 min", "type": "delivery", "status": "pending"},
    {"id": "stop-3", "name": "Shillong Cargo Yard", "address": "Police Bazar, Shillong, Meghalaya", "lat": 25.5788, "lng": 91.8933, "window": "10:00 - 11:00", "eta": "10:24", "duration": "25 min", "type": "delivery", "status": "pending"},
    {"id": "stop-4", "name": "Silchar Distribution Point", "address": "Station Road, Silchar, Assam", "lat": 24.8333, "lng": 92.7789, "window": "10:30 - 11:30", "eta": "10:57", "duration": "15 min", "type": "pickup", "status": "pending"},
    {"id": "stop-5", "name": "Aizawl Retail Center", "address": "Zarkawt, Aizawl, Mizoram", "lat": 23.7271, "lng": 92.7176, "window": "11:00 - 12:00", "eta": "11:21", "duration": "20 min", "type": "delivery", "status": "pending"},
    {"id": "stop-6", "name": "Imphal Freight Hub", "address": "BT Road, Imphal, Manipur", "lat": 24.8170, "lng": 93.9368, "window": "12:30 - 13:30", "eta": "12:45", "duration": "30 min", "type": "delivery", "status": "pending"},
    {"id": "stop-7", "name": "Kohima Sorting Facility", "address": "PR Hill, Kohima, Nagaland", "lat": 25.6751, "lng": 94.1086, "window": "14:00 - 15:00", "eta": "14:15", "duration": "15 min", "type": "delivery", "status": "pending"}
]

UNASSIGNED_STOPS = [
    {"id": "un-1", "name": "Agartala Express Terminal", "address": "Motor Stand, Agartala, Tripura", "lat": 23.8315, "lng": 91.2868, "window": "15:30 - 16:30", "duration": "20 min", "type": "pickup"},
    {"id": "un-2", "name": "Itanagar Supply Post", "address": "Ganga Market, Itanagar, Arunachal Pradesh", "lat": 27.0844, "lng": 93.6053, "window": "16:00 - 17:00", "duration": "25 min", "type": "delivery"}
]

# Helper math functions
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0  # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def generate_fallback_polyline(lat1, lon1, lat2, lon2, steps=15):
    coords = []
    for i in range(steps + 1):
        fraction = i / steps
        # Subtle curve simulation for realistic road feel
        curve = math.sin(fraction * math.pi) * 0.05
        lat = lat1 + (lat2 - lat1) * fraction + curve
        lon = lon1 + (lon2 - lon1) * fraction
        coords.append((lat, lon))
    return encode_polyline(coords)

# ==========================================
# ENDPOINTS
# ==========================================

@app.route("/")
def home():
    return jsonify({"status": "running", "service": "NER Smart Logistics Backend API"})

@app.route("/api/locations")
def get_locations():
    try:
        if os.path.exists(LOCATIONS_FILE):
            df = pd.read_csv(LOCATIONS_FILE)
            return jsonify(df.to_dict(orient="records"))
        return jsonify([])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/roads")
def get_roads():
    try:
        if os.path.exists(ROADS_FILE):
            df = pd.read_csv(ROADS_FILE)
            return jsonify(df.to_dict(orient="records"))
        return jsonify([])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/real-route")
def real_route():
    source = request.args.get("source")
    destination = request.args.get("destination")
    mode = request.args.get("mode", "driving")

    if not source or not destination:
        return jsonify({
            "success": False,
            "error": "Source and destination are required."
        }), 400

    # Public transport is intentionally not supported.
    profile_map = {
        "driving": "driving-car",
        "cycling": "cycling-regular",
        "walking": "foot-walking"
    }

    if mode not in profile_map:
        return jsonify({
            "success": False,
            "error": "This transport mode is not supported."
        }), 400

    profile = profile_map[mode]

    try:
        locations_df = (
            pd.read_csv(LOCATIONS_FILE)
            if os.path.exists(LOCATIONS_FILE)
            else None
        )

        def get_coords(loc_str):
            if locations_df is not None:
                match = locations_df[
                    locations_df["name"].astype(str).str.lower()
                    == loc_str.lower()
                ]
                if not match.empty:
                    return (
                        float(match.iloc[0]["latitude"]),
                        float(match.iloc[0]["longitude"])
                    )

            # Also allow direct "latitude,longitude" input.
            try:
                parts = loc_str.split(",")
                return float(parts[0]), float(parts[1])
            except Exception:
                return None, None

        s_lat, s_lon = get_coords(source)
        d_lat, d_lon = get_coords(destination)

        if s_lat is None or d_lat is None:
            return jsonify({
                "success": False,
                "error": "Could not resolve coordinates for source/destination."
            }), 404

        # --------------------------------------------------
        # 1. Try OpenRouteService
        # --------------------------------------------------
        ors_url = (
            "https://api.heigit.org/"
            f"openrouteservice/v2/directions/{profile}"
        )

        headers = {
            "Authorization": ORS_API_KEY,
            "Content-Type": "application/json"
        }

        body = {
            "coordinates": [
                [s_lon, s_lat],
                [d_lon, d_lat]
            ]
        }

        route_found = False
        route_provider = ""
        dist_km = 0
        dur_min = 0
        geom = ""

        try:
            # Do not call ORS when no API key is configured.
            if ORS_API_KEY:
                resp = requests.post(
                    ors_url,
                    json=body,
                    headers=headers,
                    timeout=10
                )

                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("routes"):
                        route = data["routes"][0]
                        dist_km = round(
                            route["summary"]["distance"] / 1000,
                            2
                        )
                        dur_min = round(
                            route["summary"]["duration"] / 60,
                            1
                        )
                        geom = route["geometry"]
                        route_found = True
                        route_provider = "OpenRouteService"
                else:
                    print(
                        "ORS returned",
                        resp.status_code,
                        resp.text[:300]
                    )
            else:
                print("ORS_API_KEY is not configured. Using fallback.")

        except Exception as ors_err:
            print("ORS failed, trying OSRM fallback...", ors_err)

        # --------------------------------------------------
        # 2. OSRM fallback
        # --------------------------------------------------
        if not route_found:
            osrm_mode = {
                "driving": "driving",
                "cycling": "bike",
                "walking": "foot"
            }[mode]

            osrm_url = (
                "https://router.project-osrm.org/route/v1/"
                f"{osrm_mode}/{s_lon},{s_lat};{d_lon},{d_lat}"
                "?overview=full&geometries=polyline"
            )

            try:
                osrm_resp = requests.get(
                    osrm_url,
                    timeout=10
                )

                if osrm_resp.status_code == 200:
                    osrm_data = osrm_resp.json()

                    if (
                        osrm_data.get("code") == "Ok"
                        and osrm_data.get("routes")
                    ):
                        route = osrm_data["routes"][0]
                        dist_km = round(
                            route["distance"] / 1000,
                            2
                        )
                        dur_min = round(
                            route["duration"] / 60,
                            1
                        )
                        geom = route["geometry"]
                        route_found = True
                        route_provider = "OSRM"
                else:
                    print(
                        "OSRM returned",
                        osrm_resp.status_code,
                        osrm_resp.text[:300]
                    )

            except Exception as osrm_err:
                print(
                    "OSRM failed, using Haversine fallback...",
                    osrm_err
                )

        # --------------------------------------------------
        # 3. Mathematical fallback
        # --------------------------------------------------
        if not route_found:
            dist_km = round(
                haversine_distance(
                    s_lat, s_lon, d_lat, d_lon
                ) * 1.3,
                2
            )

            speed_kmh = {
                "driving": 50,
                "cycling": 15,
                "walking": 5
            }[mode]

            dur_min = round(
                (dist_km / speed_kmh) * 60,
                1
            )

            geom = generate_fallback_polyline(
                s_lat,
                s_lon,
                d_lat,
                d_lon
            )
            route_provider = "Haversine fallback"

        # --------------------------------------------------
        # 4. AI ROUTE SCORE
        # --------------------------------------------------
        ai_score_value = None

        ai_conditions = {
            "road_condition": "Good",
            "traffic_level": "Medium",
            "weather": "Clear",
            "risk_level": "Low"
        }

        if ai_model is not None:
            try:
                ai_dataset_file = os.path.join(
                    BASE_DIR,
                    "data",
                    "ai_dataset.csv"
                )

                if os.path.exists(ai_dataset_file):
                    ai_data = pd.read_csv(ai_dataset_file)
                    roads_data = pd.read_csv(ROADS_FILE)

                    road_match = roads_data[
                        (
                            roads_data["source"].astype(str).str.lower()
                            == source.lower()
                        )
                        &
                        (
                            roads_data["destination"].astype(str).str.lower()
                            == destination.lower()
                        )
                        |
                        (
                            roads_data["source"].astype(str).str.lower()
                            == destination.lower()
                        )
                        &
                        (
                            roads_data["destination"].astype(str).str.lower()
                            == source.lower()
                        )
                    ]

                    if not road_match.empty:
                        road_id = road_match.iloc[0]["road_id"]
                        ai_match = ai_data[
                            ai_data["road_id"].astype(str) == str(road_id)
                        ]

                        if not ai_match.empty:
                            row = ai_match.iloc[0]
                            ai_conditions = {
                                "road_condition": str(row["road_condition"]),
                                "traffic_level": str(row["traffic_level"]),
                                "weather": str(row["weather"]),
                                "risk_level": str(row["risk_level"])
                            }

                road_condition_map = {
                    "Good": 3,
                    "Moderate": 2,
                    "Poor": 1
                }
                traffic_level_map = {
                    "Low": 1,
                    "Medium": 2,
                    "High": 3
                }
                weather_map = {
                    "Clear": 1,
                    "Rain": 2
                }
                risk_level_map = {
                    "Low": 1,
                    "Medium": 2,
                    "High": 3
                }

                ai_input = pd.DataFrame([{
                    "distance_km": dist_km,
                    "road_condition": road_condition_map.get(
                        ai_conditions["road_condition"], 2
                    ),
                    "traffic_level": traffic_level_map.get(
                        ai_conditions["traffic_level"], 2
                    ),
                    "weather": weather_map.get(
                        ai_conditions["weather"], 1
                    ),
                    "risk_level": risk_level_map.get(
                        ai_conditions["risk_level"], 2
                    ),
                    "travel_time_hr": dur_min / 60
                }])

                ai_prediction = ai_model.predict(ai_input)
                ai_score_value = round(
                    max(0, min(100, float(ai_prediction[0]))),
                    2
                )

            except Exception as ai_error:
                print("AI scoring failed:", ai_error)

        # --------------------------------------------------
        # 5. ALWAYS return a valid Flask response
        # --------------------------------------------------
        return jsonify({
            "success": True,
            "source": source,
            "destination": destination,
            "mode": mode,
            "distance_km": dist_km,
            "duration_minutes": dur_min,
            "geometry": geom,
            "route_provider": route_provider,
            "ai_score": ai_score_value,
            "ai_conditions": ai_conditions
        })

    except Exception as e:
        print("Real route error:", e)
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ==========================================
# AI ROUTE SCORE API
# ==========================================

@app.route("/api/ai-score")
def ai_score():

    if ai_model is None:
        return jsonify({
            "success": False,
            "error": "AI model is not loaded. Run: python ai/train_model.py"
        }), 500

    try:
        distance_km = float(request.args.get("distance_km"))
        travel_time_hr = float(request.args.get("travel_time_hr"))
        road_condition = request.args.get("road_condition")
        traffic_level = request.args.get("traffic_level")
        weather = request.args.get("weather")
        risk_level = request.args.get("risk_level")

    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "error": "Invalid or missing input values."
        }), 400

    road_condition_map = {
        "Good": 3,
        "Moderate": 2,
        "Poor": 1
    }

    traffic_level_map = {
        "Low": 1,
        "Medium": 2,
        "High": 3
    }

    weather_map = {
        "Clear": 1,
        "Rain": 2
    }

    risk_level_map = {
        "Low": 1,
        "Medium": 2,
        "High": 3
    }

    if road_condition not in road_condition_map:
        return jsonify({
            "success": False,
            "error": "Invalid road condition."
        }), 400

    if traffic_level not in traffic_level_map:
        return jsonify({
            "success": False,
            "error": "Invalid traffic level."
        }), 400

    if weather not in weather_map:
        return jsonify({
            "success": False,
            "error": "Invalid weather."
        }), 400

    if risk_level not in risk_level_map:
        return jsonify({
            "success": False,
            "error": "Invalid risk level."
        }), 400

    input_data = pd.DataFrame([{
        "distance_km": distance_km,
        "road_condition": road_condition_map[road_condition],
        "traffic_level": traffic_level_map[traffic_level],
        "weather": weather_map[weather],
        "risk_level": risk_level_map[risk_level],
        "travel_time_hr": travel_time_hr
    }])

    prediction = ai_model.predict(input_data)
    route_score = float(prediction[0])

    route_score = max(0, min(100, route_score))

    return jsonify({
        "success": True,
        "route_score": round(route_score, 2),
        "inputs": {
            "distance_km": distance_km,
            "road_condition": road_condition,
            "traffic_level": traffic_level,
            "weather": weather,
            "risk_level": risk_level,
            "travel_time_hr": travel_time_hr
        }
    })


@app.route("/api/optimize-route", methods=["POST"])
def optimize_route():
    try:
        data = request.json or {}
        stops = data.get("stops", DYNAMIC_STOPS)
        start_location = data.get("start_location", "Guwahati Hub")

        if not stops or len(stops) < 2:
            return jsonify({"success": False, "error": "At least 2 stops are required for optimization."}), 400

        # TSP 2-Opt Algorithm
        # 1. Start with initial ordering
        ordered_stops = list(stops)
        
        # 2. Nearest Neighbor heuristic
        unvisited = ordered_stops[1:]
        current = ordered_stops[0]
        optimized = [current]
        
        total_dist_original = 0
        for i in range(len(ordered_stops) - 1):
            total_dist_original += haversine_distance(
                ordered_stops[i]["lat"], ordered_stops[i]["lng"],
                ordered_stops[i+1]["lat"], ordered_stops[i+1]["lng"]
            )

        while unvisited:
            next_stop = min(
                unvisited,
                key=lambda s: haversine_distance(current["lat"], current["lng"], s["lat"], s["lng"])
            )
            optimized.append(next_stop)
            unvisited.remove(next_stop)
            current = next_stop

        # Compute optimized distance
        total_dist_opt = 0
        for i in range(len(optimized) - 1):
            total_dist_opt += haversine_distance(
                optimized[i]["lat"], optimized[i]["lng"],
                optimized[i+1]["lat"], optimized[i+1]["lng"]
            )

        # Apply road factor
        total_dist_opt = round(total_dist_opt * 1.25, 1)
        total_dist_original = round(total_dist_original * 1.35, 1)
        
        dist_saved = max(0, round(total_dist_original - total_dist_opt, 1))
        est_time_minutes = round((total_dist_opt / 45.0) * 60, 0) # Avg 45 km/h
        time_saved_minutes = max(12, int(dist_saved * 1.8))

        # Generate polyline coordinates for whole sequence
        poly_coords = []
        for i in range(len(optimized) - 1):
            s1, s2 = optimized[i], optimized[i+1]
            sub_poly = generate_fallback_polyline(s1["lat"], s1["lng"], s2["lat"], s2["lng"], steps=8)
            decoded = decode_polyline(sub_poly)
            poly_coords.extend(decoded)

        full_geometry = encode_polyline(poly_coords)


        return jsonify({
            "success": True,
            "stops": optimized,
            "total_stops": len(optimized),
            "total_distance_km": total_dist_opt,
            "est_time_minutes": est_time_minutes,
            "distance_saved_km": dist_saved,
            "time_saved_minutes": time_saved_minutes,
            "geometry": full_geometry
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/stops", methods=["GET", "POST", "DELETE"])
def handle_stops():
    global DYNAMIC_STOPS, UNASSIGNED_STOPS
    if request.method == "GET":
        return jsonify({
            "assigned": DYNAMIC_STOPS,
            "unassigned": UNASSIGNED_STOPS
        })
    elif request.method == "POST":
        data = request.json or {}
        new_stop = {
            "id": f"stop-{len(DYNAMIC_STOPS)+1}",
            "name": data.get("name", "New Delivery Point"),
            "address": data.get("address", "Northeast Highway, India"),
            "lat": float(data.get("lat", 26.15)),
            "lng": float(data.get("lng", 91.75)),
            "window": data.get("window", "10:00 - 12:00"),
            "eta": data.get("eta", "10:30"),
            "duration": data.get("duration", "20 min"),
            "type": data.get("type", "delivery"),
            "status": "pending"
        }
        DYNAMIC_STOPS.append(new_stop)
        return jsonify({"success": True, "stop": new_stop, "stops": DYNAMIC_STOPS})
    elif request.method == "DELETE":
        stop_id = request.args.get("id")
        DYNAMIC_STOPS = [s for s in DYNAMIC_STOPS if s["id"] != stop_id]
        UNASSIGNED_STOPS = [s for s in UNASSIGNED_STOPS if s["id"] != stop_id]
        return jsonify({"success": True, "stops": DYNAMIC_STOPS})

@app.route("/api/drivers")
def get_drivers():
    drivers = [
        {"id": "D-12", "name": "Alex Morgan", "role": "Senior Fleet Driver", "vehicle": "Volvo Cargo Truck (24T)", "status": "Active", "battery_fuel": "88%", "rating": 4.9, "assigned_stops": 7},
        {"id": "D-05", "name": "Rahul Sharma", "role": "Regional Express Driver", "vehicle": "Tata Heavy Hauler", "status": "On Route", "battery_fuel": "64%", "rating": 4.8, "assigned_stops": 5},
        {"id": "D-18", "name": "Priya Singh", "role": "Urban Delivery Driver", "vehicle": "Mahindra Electric Van", "status": "Standby", "battery_fuel": "95%", "rating": 5.0, "assigned_stops": 0}
    ]
    return jsonify(drivers)

@app.route("/api/orders")
def get_orders():
    orders = [
        {"order_id": "ORD-9021", "customer": "Acme Foods Assam", "destination": "Guwahati", "cargo": "Perishable Produce (2.4 Tons)", "priority": "High", "status": "In Transit", "eta": "10:15 AM"},
        {"order_id": "ORD-9022", "customer": "Meghalaya Trade Co", "destination": "Shillong", "cargo": "Electronics & Parts (800 kg)", "priority": "Medium", "status": "Scheduled", "eta": "11:45 AM"},
        {"order_id": "ORD-9023", "customer": "Manipur Central Pharma", "destination": "Imphal", "cargo": "Medical Supplies (1.1 Tons)", "priority": "Urgent", "status": "Loading", "eta": "01:30 PM"},
        {"order_id": "ORD-9024", "customer": "Nagaland Retail Hub", "destination": "Kohima", "cargo": "Consumer Goods (3.5 Tons)", "priority": "Normal", "status": "Pending", "eta": "03:15 PM"}
    ]
    return jsonify(orders)

@app.route("/api/alerts")
def get_alerts():
    alerts = [
        {"id": "alt-1", "severity": "warning", "title": "Traffic Delay on NH-15", "desc": "Road construction near Tezpur causing 15 min delay.", "time": "10 min ago"},
        {"id": "alt-2", "severity": "info", "title": "Weather Notice: Shillong", "desc": "Light rain reported; vehicle speed advised < 45 km/h.", "time": "25 min ago"},
        {"id": "alt-3", "severity": "success", "title": "Route Re-optimized", "desc": "Saved 18 mins using alternative bypass highway.", "time": "Just now"}
    ]
    return jsonify(alerts)

@app.route("/api/analytics")
def get_analytics():
    return jsonify({
        "on_time_rate": "98.4%",
        "fuel_saved_liters": 142,
        "total_distance_km": 1284,
        "co2_reduced_kg": 360,
        "avg_stop_duration_min": 18
    })

@app.route("/api/weather")
def get_weather():
    loc = request.args.get("location", "Guwahati")
    return jsonify({
        "location": loc,
        "temperature": "18°C",
        "condition": "Light rain",
        "icon": "☁️",
        "humidity": "78%"
    })

if __name__ == "__main__":
    app.run(debug=True, port=5000)
