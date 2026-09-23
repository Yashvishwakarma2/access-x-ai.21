import pandas as pd

locations = pd.read_csv("data/locations.csv")
roads = pd.read_csv("data/roads.csv")

print("LOCATIONS")
print(locations)

print("\nROADS")
print(roads)

roads.to_dict(orient="records")