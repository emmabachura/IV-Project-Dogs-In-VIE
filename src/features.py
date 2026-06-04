import pandas as pd
import geopandas as gpd
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
DISTRICTS_SHAPEFILE = PROJECT_ROOT / "data" / "raw" / "Zählbezirk" / "ZAEHLBEZIRKOGDPolygon.shp"



def engineer_features():
    dogs_df = pd.read_csv(PROCESSED_DIR / "dogs_clean.csv")
    dogs_per_district = dogs_df.groupby("district")["dog_count"].sum().reset_index()

    zones_df = pd.read_csv(PROCESSED_DIR / "zones_clean.csv")
    zones_gdf = gpd.GeoDataFrame(
        zones_df, 
        geometry=gpd.points_from_xy(zones_df.longitude, zones_df.latitude),
        crs="EPSG:4326"
    )

   
    districts_gdf = gpd.read_file(DISTRICTS_SHAPEFILE).to_crs("EPSG:4326")

    zones_with_districts = gpd.sjoin(zones_gdf, districts_gdf, how="inner", predicate="intersects")
    
    zones_per_district = zones_with_districts.groupby("BEZNR").agg(
        total_zone_area_m2=("area_m2", "sum"),
        fenced_zones=("is_fenced", lambda x: (x == True).sum()),
        water_zones=("has_water", lambda x: (x == True).sum())
    ).reset_index()
    zones_per_district.rename(columns={"BEZNR": "district"}, inplace=True)


    final_df = pd.merge(dogs_per_district, zones_per_district, on="district", how="left").fillna(0)
    final_df["space_per_dog_m2"] = final_df["total_zone_area_m2"] / final_df["dog_count"]

    final_df.to_json(PROCESSED_DIR / "district_metrics.json", orient="records")
    print("Feature engineering complete. Saved district_metrics.json")

if __name__ == "__main__":
    engineer_features()