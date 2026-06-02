from pathlib import Path
import pandas as pd
import regex as re

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


def clean_dogs_vienna():
    # First row is only a title, so skip it.
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

    df = df.rename(columns={
        "postal_code": "postal_code",
        "dog_breed": "breed",
        "anzahl": "dog_count",
        "ref_date": "ref_date"
    })

    df = df[["postal_code", "breed", "dog_count", "ref_date"]].copy()

    df["postal_code"] = pd.to_numeric(df["postal_code"], errors="coerce").astype("Int64")
    df["district"] = df["postal_code"].apply(extract_district_from_postal_code).astype("Int64")

    df["breed"] = df["breed"].astype(str).str.strip()
    df["dog_count"] = pd.to_numeric(df["dog_count"], errors="coerce").fillna(0).astype(int)
    df["ref_date"] = pd.to_datetime(df["ref_date"], format="%Y%m%d", errors="coerce")

    df = df.dropna(subset=["district", "breed"])

    df = (
        df.groupby(["district", "postal_code", "breed", "ref_date"], as_index=False)
        .agg(dog_count=("dog_count", "sum"))
        .sort_values(["district", "breed"])
    )

    df = df[["district", "postal_code", "breed", "dog_count", "ref_date"]]

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
    """
    HUNDETRAENKE appears to contain values like:
    1, 2, keine
    We keep the original value and also create a boolean field.
    """
    if pd.isna(value):
        return False
    value = str(value).strip().lower()
    if value in ["keine", "nein", "", "nan"]:
        return False
    return True

def clean_yes_no(value):
    if pd.isna(value):
        return pd.NA
    value = str(value).strip().lower()
    if value == "ja":
        return True
    if value == "nein":
        return False
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
    df["is_fenced"] = df["fenced_raw"].apply(clean_yes_no)
    df["park_name"] = df["park_name"].str.strip()
    df["zone_type"] = df["zone_type"].str.strip()
    # Useful simple quality score.

    # You can later refine this in your feature engineering step.

    df["quality_score"] = 0
    df.loc[df["area_m2"] >= 1000, "quality_score"] += 1
    df.loc[df["area_m2"] >= 3000, "quality_score"] += 1
    df.loc[df["has_water"] == True, "quality_score"] += 1
    df.loc[df["is_fenced"] == True, "quality_score"] += 1

    cols = [
        "fid",
        "object_id",
        "park_name",
        "zone_type",
        "area_m2",
        "is_fenced",
        "has_water",
        "quality_score",
        "longitude",
        "latitude",
        "geometry_wkt",
        "web_link"
    ]

    df_clean = df[cols].copy()
    # Remove rows without coordinates because they cannot be mapped.
    df_clean = df_clean.dropna(subset=["longitude", "latitude"])
    # Remove rows without usable area if needed.
    # You can comment this out if you want to inspect missing area values later.
    df_clean = df_clean.dropna(subset=["area_m2"])
    df_clean = df_clean.sort_values("area_m2", ascending=False)
    df_clean.to_csv(OUTPUT_FILE_ZONES, index=False)
    print(f"Saved: {OUTPUT_FILE_ZONES}")

if __name__ == "__main__":
    clean_dogs_vienna()
    clean_dog_zones()

