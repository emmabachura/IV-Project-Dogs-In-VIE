import numpy as np
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

    # Remove old spatial join columns from any previous runs so the new join is clean
    drop_suffixes = ["_left", "_right"]
    zones_df = zones_df.loc[:, ~zones_df.columns.str.endswith(tuple(drop_suffixes))]

    # Keep only the original zone fields needed for spatial join and output
    original_zone_cols = [
        "object_id", "park_name", "phone", "zone_type", "area_m2",
        "is_fenced", "has_water", "quality_score", "longitude", "latitude",
        "web_link"
    ]
    zones_df = zones_df[[c for c in original_zone_cols if c in zones_df.columns]]

    zones_gdf = gpd.GeoDataFrame(
        zones_df,
        geometry=gpd.points_from_xy(zones_df.longitude, zones_df.latitude),
        crs="EPSG:4326"
    )

    districts_gdf = gpd.read_file(DISTRICTS_SHAPEFILE).to_crs("EPSG:4326")

    zones_with_districts = gpd.sjoin(
        zones_gdf,
        districts_gdf,
        how="inner",
        predicate="intersects"
    )

    district_source = "BEZNR_right" if "BEZNR_right" in zones_with_districts.columns else "BEZNR"
    zones_with_districts["district"] = pd.to_numeric(zones_with_districts[district_source], errors="coerce")

    enriched_zones = pd.merge(
        zones_with_districts,
        dogs_per_district[["district", "dog_count"]],
        on="district",
        how="left"
    )

    enriched_zones.rename(columns={"dog_count": "district_dog_count"}, inplace=True)

    save_cols = [
        c for c in enriched_zones.columns
        if c not in ['geometry', 'index_right'] and not c.endswith(('_left', '_right'))
    ]
    enriched_zones[save_cols].to_csv(PROCESSED_DIR / "zones_clean.csv", index=False)

    zone_district_col = "BEZNR_right" if "BEZNR_right" in zones_with_districts.columns else "BEZNR"
    zones_per_district = (
        zones_with_districts
        .groupby(zone_district_col, as_index=False)
        .agg(
            total_zone_area_m2=("area_m2", "sum"),
            zone_count=("object_id", "count"),
            fenced_zones=("is_fenced", lambda x: (x == "yes").sum()),
            partially_fenced_zones=("is_fenced", lambda x: (x == "partially").sum()),
            water_zones=("has_water", lambda x: (x != "no").sum()),
            average_quality_score=("quality_score", "mean")
        )
    )
    zones_per_district.rename(columns={zone_district_col: "district"}, inplace=True)

    final_df = pd.merge(dogs_per_district, zones_per_district, on="district", how="left").fillna(0)
    final_df["space_per_dog_m2"] = final_df["total_zone_area_m2"] / final_df["dog_count"]

    final_df.to_json(PROCESSED_DIR / "district_metrics.json", orient="records")

    zb_district_col = "ZBEZ_right" if "ZBEZ_right" in zones_with_districts.columns else "ZBEZ"
    zb_zones = (
        zones_with_districts
        .groupby(zb_district_col, as_index=False)
        .agg(
            total_area=("area_m2", "sum"),
            zone_count=("object_id", "count"),
            fenced_count=("is_fenced", lambda x: (x == "yes").sum() + (x == "partially").sum()),
            water_count=("has_water", lambda x: (x != "no").sum())
        )
    )

    zb_zones.rename(columns={zb_district_col: "ZBEZ"}, inplace=True)
    zb_zones["infra_score"] = (
            (zb_zones["zone_count"] * 25) +
            (zb_zones["fenced_count"] * 15) +
            (zb_zones["water_count"] * 15) +
            (np.log10(zb_zones["total_area"] + 1) * 10)
    )

    zb_zones["infra_rank"] = zb_zones["infra_score"].rank(ascending=False, method="min")

    zb_zones.to_json(PROCESSED_DIR / "zaehlbezirk_metrics.json", orient="records")

    print("Feature engineering complete. Saved district_metrics.json")


if __name__ == "__main__":
    engineer_features()
