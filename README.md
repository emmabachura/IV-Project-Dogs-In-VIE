# Dog-Friendly Spaces in Vienna

Interactive visualization project for exploring dog-friendly infrastructure in Vienna.

The project combines dog registration data, dog-zone data, and Vienna district / sub-district geometries to compare infrastructure supply against dog-related demand.

## Features

- Interactive Vienna map with dog-zone markers
- Scatterplot of dog-zone area vs. registered dogs in the district
- Filter controls for minimum area, water availability, fencing, and zone type
- Heatmap mode for sub-district infrastructure scores
- District popup with composite district score, infrastructure score, and dog-pressure score

## Setup

### 1. Create and activate a virtual environment

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

## Running the App

From the repository root:

```powershell
python app\app.py
```

Then open:

```text
http://127.0.0.1:5000
```

## Rebuilding the Processed Data

The repository already contains processed data in [data/processed](data/processed), so rebuilding is optional unless cleaning or feature scripts are changed.

Run the preprocessing pipeline from the repository root in this order:

```powershell
python src\1_clean.py
python src\features.py
```

This generates or updates:

- [data/processed/dogs_clean.csv](data/processed/dogs_clean.csv)
- [data/processed/zones_clean.csv](data/processed/zones_clean.csv)
- [data/processed/district_metrics.json](data/processed/district_metrics.json)
- [data/processed/zaehlbezirk_metrics.json](data/processed/zaehlbezirk_metrics.json)

## Data Processing Overview

### Cleaning

- Dog registration data is cleaned and assigned to Vienna districts via postal codes.
- Breeds are grouped into `small`, `medium`, `large`, and `unknown` size classes.
- Dog-zone data is cleaned, area values are parsed, and point coordinates are extracted.
- Dog-prohibited areas are removed from the cleaned zone dataset.

### Feature Engineering

- Dog zones are spatially joined to Vienna district and sub-district geometries.
- District metrics include dog counts, dog-size shares, total dog-zone area, water/fencing counts, and space per dog.
- Sub-districts receive an infrastructure score based on:
	- number of dog zones
	- fenced zones
	- water access
	- total dog-zone area
- Districts receive a composite district score combining:
	- normalized average sub-district infrastructure
	- size-weighted effective dog demand

## Main Views

### District View

- Vienna district boundaries
- Dog-zone markers
- Linked scatterplot for individual zones
- District popup with score and summary statistics

### Heatmap View

- Sub-district heatmap using infrastructure scores
- Top 10 ranked sub-district chart
- Hover highlighting between map and chart

## Score Summary

The project uses two score levels:

- `infra_score`: normalized sub-district infrastructure score on a 0-100 scale
- `district_score`: weighted district-level score combining infrastructure and dog pressure

The district score is based on:

- `65%` infrastructure component score
- `35%` dog-pressure component score

The two district-level components come from the feature pipeline in [src/features.py](src/features.py):

- `infrastructure_component_score`: first, each sub-district gets an infrastructure score based on dog-zone count, fencing, water access, and total dog-zone area. That sub-district score is normalized to `0-100`, then averaged across all sub-districts in a district, including sub-districts with no dog zones as `0`. Finally, that district average is normalized again across all districts to create the infrastructure component score.
- `dog_pressure_component_score`: each district gets an `effective_dog_count`, where small, medium, large, and unknown dogs are weighted differently to reflect different space demand. That weighted dog count is normalized across all districts and inverted as `100 - normalized_value`, so districts with lower dog pressure receive a higher score.

The final district score is:

- `district_score = 0.65 * infrastructure_component_score + 0.35 * dog_pressure_component_score`
