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

    dogs_by_size = (
        dogs_df
        .groupby(["district", "dog_size"], as_index=False)
        .agg(size_dog_count=("dog_count", "sum"))
    )

    dogs_size_wide = (
        dogs_by_size
        .pivot(index="district", columns="dog_size", values="size_dog_count")
        .fillna(0)
        .reset_index()
    )

    for size in ["small", "medium", "large", "unknown"]:
        if size not in dogs_size_wide.columns:
            dogs_size_wide[size] = 0

    dogs_size_wide = dogs_size_wide.rename(columns={
        "small": "small_dog_count",
        "medium": "medium_dog_count",
        "large": "large_dog_count",
        "unknown": "unknown_dog_count",
    })

    dogs_per_district = pd.merge(
        dogs_per_district,
        dogs_size_wide,
        on="district",
        how="left"
    ).fillna(0)

    dogs_per_district["small_dog_percent"] = (
            dogs_per_district["small_dog_count"] / dogs_per_district["dog_count"] * 100
    )

    dogs_per_district["medium_dog_percent"] = (
            dogs_per_district["medium_dog_count"] / dogs_per_district["dog_count"] * 100
    )

    dogs_per_district["large_dog_percent"] = (
            dogs_per_district["large_dog_count"] / dogs_per_district["dog_count"] * 100
    )

    dogs_per_district["unknown_dog_percent"] = (
            dogs_per_district["unknown_dog_count"] / dogs_per_district["dog_count"] * 100
    )

    zones_df = pd.read_csv(PROCESSED_DIR / "zones_clean.csv")
    zones_gdf = gpd.GeoDataFrame(
        zones_df, 
        geometry=gpd.points_from_xy(zones_df.longitude, zones_df.latitude),
        crs="EPSG:4326"
    )

   
    districts_gdf = gpd.read_file(DISTRICTS_SHAPEFILE).to_crs("EPSG:4326")

    zones_with_districts = gpd.sjoin(zones_gdf, districts_gdf, how="inner", predicate="intersects")

    zones_per_district = (
        zones_with_districts
        .groupby("BEZNR", as_index=False)
        .agg(
            total_zone_area_m2=("area_m2", "sum"),
            zone_count=("object_id", "count"),
            fenced_zones=("is_fenced", lambda x: (x == "yes").sum()),
            partially_fenced_zones=("is_fenced", lambda x: (x == "partially").sum()),
            water_zones=("has_water", lambda x: (x != "no").sum()),
            average_quality_score=("quality_score", "mean")
        )
    )
    zones_per_district.rename(columns={"BEZNR": "district"}, inplace=True)


    final_df = pd.merge(dogs_per_district, zones_per_district, on="district", how="left").fillna(0)
    final_df["space_per_dog_m2"] = final_df["total_zone_area_m2"] / final_df["dog_count"]

    final_df.to_json(PROCESSED_DIR / "district_metrics.json", orient="records")
    print("Feature engineering complete. Saved district_metrics.json")

if __name__ == "__main__":
    engineer_features()