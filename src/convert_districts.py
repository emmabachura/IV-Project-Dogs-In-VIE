"""
Convert Vienna counting district boundaries to GeoJSON.

This script reads the original counting district shapefile, converts it to
WGS84 coordinates, and saves it as a GeoJSON file for later use in maps.
"""
from pathlib import Path
import geopandas as gpd

PROJECT_ROOT = Path(__file__).resolve().parents[1]

INPUT_FILE = PROJECT_ROOT / "data" / "raw" / "Zählbezirk" / "ZAEHLBEZIRKOGDPolygon.shp"
OUTPUT_FILE = PROJECT_ROOT / "data" / "processed" / "vienna_zaehlbezirke.geojson"

OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

zb_gdf = gpd.read_file(INPUT_FILE)

print("Original CRS:", zb_gdf.crs)
print(zb_gdf.columns)

zb_gdf = zb_gdf.to_crs("EPSG:4326")

zb_gdf.to_file(OUTPUT_FILE, driver="GeoJSON")

print(f"Saved converted file to: {OUTPUT_FILE}")