from flask import Flask, jsonify, render_template
import pandas as pd
import json
from pathlib import Path

app = Flask(__name__, static_folder='static', template_folder='.')

PROCESSED_DIR = Path(__file__).resolve().parents[1] / "data" / "processed"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/metrics")
def get_metrics():
    # Serves the district-level ratios for the choropleth map and scatterplot
    with open(PROCESSED_DIR / "district_metrics.json") as f:
        data = json.load(f)
    return jsonify(data)

@app.route("/api/zones")
def get_zones():
    # Serves the individual dog zones for the interactive map polygons
    zones_df = pd.read_csv(PROCESSED_DIR / "zones_clean.csv")
    zones_df = zones_df.fillna("")
    return jsonify(zones_df.to_dict(orient="records"))

@app.route("/api/districts")
def get_districts():
    with open(PROCESSED_DIR / "vienna_districts.geojson", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data)

@app.route("/api/zaehlbezirke_shapes")
def get_zb_shapes():
    with open(PROCESSED_DIR / "vienna_zaehlbezirke.geojson") as f:
        return jsonify(json.load(f))

@app.route("/api/zaehlbezirk_metrics")
def get_zb_metrics():
    with open(PROCESSED_DIR / "zaehlbezirk_metrics.json") as f:
        return jsonify(json.load(f))

if __name__ == "__main__":
    app.run(debug=True, port=5000)