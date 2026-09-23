import pandas as pd
import os

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score

import joblib


# ==========================================
# BASE DIRECTORY
# ==========================================

BASE_DIR = os.path.dirname(
    os.path.dirname(
        os.path.abspath(__file__)
    )
)


# ==========================================
# DATASET FILE
# ==========================================

DATASET_FILE = os.path.join(
    BASE_DIR,
    "data",
    "ai_dataset.csv"
)


# ==========================================
# MODEL FILE
# ==========================================

MODEL_FILE = os.path.join(
    BASE_DIR,
    "ai",
    "route_model.pkl"
)


# ==========================================
# LOAD DATASET
# ==========================================

data = pd.read_csv(DATASET_FILE)


print("\nAI DATASET")
print("=" * 60)

print(data)


# ==========================================
# CONVERT TEXT TO NUMBERS
# ==========================================

data["road_condition"] = data["road_condition"].map({
    "Good": 3,
    "Moderate": 2,
    "Poor": 1
})


data["traffic_level"] = data["traffic_level"].map({
    "Low": 1,
    "Medium": 2,
    "High": 3
})


data["weather"] = data["weather"].map({
    "Clear": 1,
    "Rain": 2
})


data["risk_level"] = data["risk_level"].map({
    "Low": 1,
    "Medium": 2,
    "High": 3
})


# ==========================================
# FEATURES
# ==========================================

features = [
    "distance_km",
    "road_condition",
    "traffic_level",
    "weather",
    "risk_level",
    "travel_time_hr"
]


X = data[features]


# ==========================================
# TARGET
# ==========================================

y = data["route_score"]


# ==========================================
# TRAIN / TEST SPLIT
# ==========================================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42
)


print("\nTRAINING DATA")
print("=" * 60)

print("Training rows:", len(X_train))


print("\nTESTING DATA")
print("=" * 60)

print("Testing rows:", len(X_test))


# ==========================================
# CREATE AI MODEL
# ==========================================

model = RandomForestRegressor(
    n_estimators=100,
    random_state=42
)


# ==========================================
# TRAIN MODEL
# ==========================================

print("\nTRAINING MODEL")
print("=" * 60)

model.fit(
    X_train,
    y_train
)

print("Model training completed!")


# ==========================================
# MAKE PREDICTIONS
# ==========================================

predictions = model.predict(X_test)


print("\nPREDICTIONS")
print("=" * 60)

for actual, predicted in zip(
    y_test,
    predictions
):

    print(
        f"Actual: {actual} | "
        f"Predicted: {predicted:.2f}"
    )


# ==========================================
# MODEL EVALUATION
# ==========================================

mae = mean_absolute_error(
    y_test,
    predictions
)

r2 = r2_score(
    y_test,
    predictions
)


print("\nMODEL PERFORMANCE")
print("=" * 60)

print(
    f"Mean Absolute Error: {mae:.2f}"
)

print(
    f"R2 Score: {r2:.2f}"
)


# ==========================================
# SAVE MODEL
# ==========================================

joblib.dump(
    model,
    MODEL_FILE
)


print("\nMODEL SAVED")
print("=" * 60)

print(
    "Saved to:",
    MODEL_FILE
)


print("\nStage 5.3 completed successfully!")