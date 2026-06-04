from pathlib import Path
import pandas as pd
import re
from dog_size_keywords import SMALL_KEYWORDS, MEDIUM_KEYWORDS, LARGE_KEYWORDS

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

INPUT_FILE_DOGS = RAW_DIR / "hunde-wien-raw.csv"
OUTPUT_FILE_DOGS = PROCESSED_DIR / "dogs_clean.csv"

INPUT_FILE_ZONES = RAW_DIR / "hunde-zonen-raw.csv"
OUTPUT_FILE_ZONES = PROCESSED_DIR / "zones_clean.csv"


def extract_district_from_postal_code(postal_code):
    """
    Vienna postal codes:
    1010 -> district 1
    1020 -> district 2
    ...
    1230 -> district 23
    """
    if pd.isna(postal_code):
        return pd.NA

    postal_code = str(postal_code).strip()

    if not postal_code.isdigit() or len(postal_code) != 4:
        return pd.NA

    return int(postal_code[1:3])

def classify_single_breed_size(breed):
    """
    Classifies one breed name as small, medium, large, or unknown.
    Uses keyword matching.
    """
    if pd.isna(breed):
        return "unknown"

    breed = str(breed).lower()

    # Check large first, because for mixed breeds we want the larger size to win.
    if any(keyword in breed for keyword in LARGE_KEYWORDS):
        return "large"

    if any(keyword in breed for keyword in MEDIUM_KEYWORDS):
        return "medium"

    if any(keyword in breed for keyword in SMALL_KEYWORDS):
        return "small"

    if "mischling" in breed or "unbekannt" in breed:
        return "unknown"

    return "unknown"


def classify_dog_size(breed):
    """
    Handles mixed breeds separated by '/'.
    Uses the largest detected category.
    """

    if pd.isna(breed):
        return "unknown"

    parts = [part.strip() for part in str(breed).split("/")]

    sizes = [classify_single_breed_size(part) for part in parts]

    if "large" in sizes:
        return "large"
    if "medium" in sizes:
        return "medium"
    if "small" in sizes:
        return "small"

    return "unknown"


def clean_dogs_vienna():
    df = pd.read_csv(
        INPUT_FILE_DOGS,
        sep=";",
        skiprows=1,
        dtype=str,
        encoding="ISO-8859-1"
    )

    df.columns = (
        df.columns
        .str.strip()
        .str.lower()
        .str.replace(" ", "_")
    )

    df = df.drop(columns=["ref_date"])

    df = df.rename(columns={
        "postal_code": "postal_code",
        "dog_breed": "breed",
        "anzahl": "dog_count",
    })

    df = df[["postal_code", "breed", "dog_count"]].copy()

    df["postal_code"] = pd.to_numeric(df["postal_code"], errors="coerce").astype("Int64")
    df["district"] = df["postal_code"].apply(extract_district_from_postal_code).astype("Int64")

    df["breed"] = df["breed"].astype(str).str.strip()
    df["dog_count"] = pd.to_numeric(df["dog_count"], errors="coerce").fillna(0).astype(int)
    df["dog_size"] = df["breed"].apply(classify_dog_size)

    df = df.dropna(subset=["district", "breed"])

    df = (
        df.groupby(["district", "postal_code", "breed", "dog_size"], as_index=False)
        .agg(dog_count=("dog_count", "sum"))
        .sort_values(["district", "breed"])
    )

    df = df[["district", "postal_code", "breed", "dog_size", "dog_count"]]

    df.to_csv(OUTPUT_FILE_DOGS, index=False)
    print(f"Saved clean file to: {OUTPUT_FILE_DOGS}")

def parse_area_m2(value):
    """
    Converts values such as:
    'ca. 989 m²'
    'ca. 2969 m²'
    into numeric square meters.
    """
    if pd.isna(value):
        return pd.NA
    value = str(value).lower()
    value = value.replace(",", ".")
    match = re.search(r"(\d+(?:\.\d+)?)", value)
    if match:
        return float(match.group(1))
    return pd.NA

def parse_point_geometry(shape):
    """
    Converts WKT point:
    POINT (16.339258670106737 48.18877473447244)
    into:
    longitude = 16.339258670106737
    latitude = 48.18877473447244
    """
    if pd.isna(shape):
        return pd.Series([pd.NA, pd.NA])
    match = re.search(
        r"POINT\s*\(\s*([0-9.\-]+)\s+([0-9.\-]+)\s*\)",
        str(shape)
    )

    if not match:
        return pd.Series([pd.NA, pd.NA])

    longitude = float(match.group(1))
    latitude = float(match.group(2))
    return pd.Series([longitude, latitude])

def clean_water_value(value):
    if pd.isna(value):
        return pd.NA
    value = str(value).strip().lower()
    if value in ["keine", "nein", "", "nan"]:
        return "no"
    return value

def clean_fenced(value):
    if pd.isna(value):
        return pd.NA
    value = str(value).strip().lower()
    if value == "ja":
        return "yes"
    if value == "nein":
        return "no"
    if value == "teilweise":
        return "partially"
    if value == "keine angabe":
        return pd.NA
    return pd.NA

def clean_dog_zones():
    df = pd.read_csv(
        INPUT_FILE_ZONES,
        sep=",",
        dtype=str,
        encoding="utf-8"
    )

    df.columns = (
        df.columns
        .str.strip()
        .str.lower()
    )

    df = df.rename(columns={
        "fid": "fid",
        "objectid": "object_id",
        "shape": "geometry_wkt",
        "park": "park_name",
        "flaeche": "area_raw",
        "typ": "zone_type",
        "telefon": "phone",
        "einfriedung": "fenced_raw",
        "weblink1": "web_link",
        "hundetraenke": "water_raw",
        "se_anno_cad_data": "cad_data"
    })

    df["area_m2"] = df["area_raw"].apply(parse_area_m2)
    df[["longitude", "latitude"]] = df["geometry_wkt"].apply(parse_point_geometry)
    df["has_water"] = df["water_raw"].apply(clean_water_value)
    df["is_fenced"] = df["fenced_raw"].apply(clean_fenced)
    df["park_name"] = df["park_name"].str.strip()
    df["zone_type"] = df["zone_type"].str.strip()
    # Useful simple quality score.

    # You can later refine this in your feature engineering step.

    df["quality_score"] = 0.0
    df.loc[df["area_m2"] >= 1000, "quality_score"] += 1.0
    df.loc[df["area_m2"] >= 3000, "quality_score"] += 1.0
    df.loc[df["has_water"] != "no", "quality_score"] += 1.0
    df.loc[df["is_fenced"] == "yes", "quality_score"] += 1.0
    df.loc[df["is_fenced"] == "partially", "quality_score"] += 0.5

    cols = [
        "object_id",
        "park_name",
        "phone",
        "zone_type",
        "area_m2",
        "is_fenced",
        "has_water",
        "quality_score",
        "longitude",
        "latitude",
        "web_link"
    ]

    df_clean = df[cols].copy()
    df_clean = df_clean.dropna(subset=["longitude", "latitude"])
    df_clean = df_clean.dropna(subset=["area_m2"])
    df_clean = df_clean.sort_values("area_m2", ascending=False)
    df_clean.to_csv(OUTPUT_FILE_ZONES, index=False)
    print(f"Saved: {OUTPUT_FILE_ZONES}")

if __name__ == "__main__":
    clean_dogs_vienna()
    clean_dog_zones()


# def show_unique_breeds():
#     df = pd.read_csv(OUTPUT_FILE_DOGS)
#
#     breeds = (
#         df["breed"]
#         .dropna()
#         .astype(str)
#         .str.strip()
#         .sort_values()
#         .unique()
#     )
#
#     print(f"Number of unique breeds: {len(breeds)}")
#     print()
#
#     for breed in breeds:
#         print(breed)