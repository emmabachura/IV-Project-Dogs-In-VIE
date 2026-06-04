import geopandas as gpd
import pandas as pd
from pathlib import Path

RAW_DIR = Path("data/raw/Map")
PROCESSED_DIR = Path("data/processed")

def create_basemap():
    print("Loading shapefiles...")
    # Load the specific FMZK layers you downloaded
    # (Update these filenames to exactly what you downloaded)
    buildings = gpd.read_file(RAW_DIR / "FMZKGRUEN1OGDPolygon.shp").to_crs("EPSG:4326")
    greenery = gpd.read_file(RAW_DIR / "FMZKGEWOGDPolygon.shp").to_crs("EPSG:4326")
    water = gpd.read_file(RAW_DIR / "FMZKGEBOGDPolygon.shp").to_crs("EPSG:4326")

    # Add a "layer_type" column so D3.js knows how to color them!
    buildings['layer_type'] = 'building'
    greenery['layer_type'] = 'greenery'
    water['layer_type'] = 'water'

    # Combine them into one massive map
    combined_map = gpd.GeoDataFrame(pd.concat([buildings, greenery, water], ignore_index=True))

    # CRITICAL: Simplify the geometries so the browser doesn't crash!
    # A tolerance of 0.0001 (in GPS degrees) smooths out microscopic bumps but keeps the shape
    print("Simplifying geometry...")
    combined_map['geometry'] = combined_map['geometry'].simplify(tolerance=0.001, preserve_topology=True)

    # Save as GeoJSON for the web
    output_path = PROCESSED_DIR / "vienna_basemap.geojson"
    combined_map[['layer_type', 'geometry']].to_file(output_path, driver="GeoJSON")
    print(f"Basemap saved to {output_path}")

if __name__ == "__main__":
    create_basemap()