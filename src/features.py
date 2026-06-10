"""
Build extra dog and dog zone features for the Vienna project.
This script uses the cleaned dog and dog zone files, adds district information
to the dog zones, and creates summary metrics for districts and counting
districts.
"""

import numpy as np
import pandas as pd
import geopandas as gpd
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
DISTRICTS_SHAPEFILE = PROJECT_ROOT / "data" / "raw" / "Zählbezirk" / "ZAEHLBEZIRKOGDPolygon.shp"

SIZE_WEIGHTS = {
    "small_dog_count": 1.0,
    "medium_dog_count": 1.15,
    "large_dog_count": 1.35,
    "unknown_dog_count": 1.1,
}


def min_max_scale(series):
    """Scale a numeric series to the range 0-100."""
    numeric = pd.to_numeric(series, errors="coerce").fillna(0)
    min_value = numeric.min()
    max_value = numeric.max()

    if pd.isna(min_value) or pd.isna(max_value) or min_value == max_value:
        return pd.Series(50.0, index=series.index)

    return ((numeric - min_value) / (max_value - min_value)) * 100


def compute_effective_dog_count(df):
    """Weight dog counts by size so larger dogs contribute slightly more demand."""
    return sum(df[column] * weight for column, weight in SIZE_WEIGHTS.items())


def engineer_features():
    """
        Creates the final feature files used for analysis.
        Combines dog counts, dog sizes, dog zone locations, and district boundaries.
        It calculates values like total dogs per district, dog zone area, number of
        zones, fencing, water availability, and space per dog.
        """
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

    drop_suffixes = ["_left", "_right"]
    zones_df = zones_df.loc[:, ~zones_df.columns.str.endswith(tuple(drop_suffixes))]

    original_zone_cols = [
        "object_id", "park_name", "phone", "zone_type", "area_m2",
        "is_fenced", "has_water", "longitude", "latitude",
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
        )
    )
    zones_per_district.rename(columns={zone_district_col: "district"}, inplace=True)

    final_df = pd.merge(dogs_per_district, zones_per_district, on="district", how="left").fillna(0)
    final_df["space_per_dog_m2"] = final_df["total_zone_area_m2"] / final_df["dog_count"]

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
    zb_zones["ZBEZ"] = pd.to_numeric(zb_zones["ZBEZ"], errors="coerce")
    zb_zones["infra_score"] = (
            (zb_zones["zone_count"] * 25) +
            (zb_zones["fenced_count"] * 15) +
            (zb_zones["water_count"] * 15) +
            (np.log10(zb_zones["total_area"] + 1) * 10)
    )

    zb_zones["infra_rank"] = zb_zones["infra_score"].rank(ascending=False, method="min")

    district_subdistricts = (
        districts_gdf[["BEZNR", "ZBEZ"]]
        .drop_duplicates()
        .rename(columns={"BEZNR": "district"})
    )
    district_subdistricts["district"] = pd.to_numeric(district_subdistricts["district"], errors="coerce")
    district_subdistricts["ZBEZ"] = pd.to_numeric(district_subdistricts["ZBEZ"], errors="coerce")

    district_subdistrict_scores = pd.merge(
        district_subdistricts,
        zb_zones[["ZBEZ", "infra_score", "zone_count"]],
        on="ZBEZ",
        how="left"
    ).fillna({"infra_score": 0, "zone_count": 0})

    district_score_components = (
        district_subdistrict_scores
        .groupby("district", as_index=False)
        .agg(
            district_avg_infra_score=("infra_score", "mean"),
            subdistrict_count=("ZBEZ", "count"),
            active_subdistrict_count=("zone_count", lambda x: (x > 0).sum())
        )
    )

    final_df["effective_dog_count"] = compute_effective_dog_count(final_df)
    final_df = pd.merge(final_df, district_score_components, on="district", how="left").fillna({
        "district_avg_infra_score": 0,
        "subdistrict_count": 0,
        "active_subdistrict_count": 0,
    })

    final_df["infrastructure_component_score"] = min_max_scale(final_df["district_avg_infra_score"])
    final_df["dog_pressure_component_score"] = 100 - min_max_scale(final_df["effective_dog_count"])
    final_df["district_score"] = (
        (final_df["infrastructure_component_score"] * 0.65) +
        (final_df["dog_pressure_component_score"] * 0.35)
    )

    final_df.to_json(PROCESSED_DIR / "district_metrics.json", orient="records")

    zb_zones.to_json(PROCESSED_DIR / "zaehlbezirk_metrics.json", orient="records")

    print("Feature engineering complete. Saved district_metrics.json")


if __name__ == "__main__":
    engineer_features()
