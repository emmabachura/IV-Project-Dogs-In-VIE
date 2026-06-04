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
    return jsonify(zones_df.to_dict(orient="records"))

if __name__ == "__main__":
    app.run(debug=True, port=5000)