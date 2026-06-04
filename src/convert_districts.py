from pathlib import Path
import geopandas as gpd

PROJECT_ROOT = Path(__file__).resolve().parents[1]

INPUT_FILE = PROJECT_ROOT / "data" / "raw" / "vienna_districts_raw.json"
OUTPUT_FILE = PROJECT_ROOT / "data" / "processed" / "vienna_districts.geojson"

OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

districts = gpd.read_file(INPUT_FILE)

print("Original CRS:", districts.crs)
print(districts.columns)

districts = districts.to_crs("EPSG:4326")

districts.to_file(OUTPUT_FILE, driver="GeoJSON")

print(f"Saved converted file to: {OUTPUT_FILE}")