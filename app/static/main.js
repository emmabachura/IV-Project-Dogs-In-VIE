// Initialize the map, center it on Vienna, and set the zoom to 12
const map = L.map('map').setView([48.2082, 16.3738], 12);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd'
}).addTo(map);

Promise.all([
    fetch("/api/districts").then(response => {
        if (!response.headers.get("content-type").includes("application/json")) {
            throw new Error("District API is not sending JSON. Check Flask /api/districts.");
        }
        return response.json();
    }),
    fetch("/api/metrics").then(response => {
        if (!response.headers.get("content-type").includes("application/json")) {
            throw new Error("Metrics API is not sending JSON. Check Flask /api/metrics.");
        }
        return response.json();
    })
])
.then(([districtData, metricsData]) => {

    const metricsByDistrict = {};
    metricsData.forEach(row => {
        metricsByDistrict[Number(row.district)] = row;
    });
    const districtLayer = L.geoJSON(districtData, {
        interactive: true,
        style: {
            color: "#333",
            weight: 1,
            fillColor: "#90caf9",
            fillOpacity: 0.18
        },
        onEachFeature: function (feature, layer) {
            const props = feature.properties;
            const districtName =
                props.NAMEK ||
                "Vienna district";
            const districtNumberRaw =
                props.BEZNR ||
                "";
            const districtNumber = Number(districtNumberRaw);
            const metrics = metricsByDistrict[districtNumber];
            let popupContent = `
                <b>${districtName}</b><br>
                District: ${districtNumber}<br>
            `;
            if (metrics) {
                popupContent += `
                    <hr>
                    <b>Dog statistics</b><br>
                    Total dogs: ${metrics.dog_count}<br>
                    Small dogs: ${metrics.small_dog_count} (${metrics.small_dog_percent.toFixed(1)}%)<br>
                    Medium dogs: ${metrics.medium_dog_count} (${metrics.medium_dog_percent.toFixed(1)}%)<br>
                    Large dogs: ${metrics.large_dog_count} (${metrics.large_dog_percent.toFixed(1)}%)<br>
                    Unknown size: ${metrics.unknown_dog_count} (${metrics.unknown_dog_percent.toFixed(1)}%)<br>
                    <hr>
                    <b>Dog zone statistics</b><br>
                    Dog zones: ${metrics.zone_count}<br>
                    Total dog zone area: ${Math.round(metrics.total_zone_area_m2).toLocaleString()} m²<br>
                    Space per dog: ${metrics.space_per_dog_m2.toFixed(1)} m²<br>
                    Fenced zones: ${metrics.fenced_zones}<br>
                    Partially fenced zones: ${metrics.partially_fenced_zones}<br>
                    Water zones: ${metrics.water_zones}<br>
                    Average quality score: ${metrics.average_quality_score.toFixed(1)}
                `;
            } else {
                popupContent += `
                    <hr>
                    No metrics available for this district.
                `;
            }
            layer.bindPopup(popupContent);
            layer.on("mouseover", function () {
                layer.setStyle({
                    weight: 3,
                    fillOpacity: 0.28
                });
            });
            layer.on("mouseout", function () {
                districtLayer.resetStyle(layer);
            });
        }
    }).addTo(map);
    districtLayer.bringToBack();
    map.fitBounds(districtLayer.getBounds());
})
.catch(error => console.error("Error loading districts or metrics:", error));

// 3. Fetch your cleaned dog zone data from your Flask backend
fetch('/api/zones')
  .then(response => {
      // Safety check: if the server sends back text/csv instead of JSON, we catch it
      if (!response.headers.get("content-type").includes("application/json")) {
          throw new Error("Backend is not sending JSON. Check your Flask app.py!");
      }
      return response.json();
  })
  .then(data => {
      
      data.forEach(park => {
          // Force the coordinates to be numbers, just in case they are strings
          const lat = parseFloat(park.latitude);
          const lng = parseFloat(park.longitude);

          // Check that they actually exist and are valid numbers
          if (!isNaN(lat) && !isNaN(lng)) {
              
              // ADVANCED VISUAL ENCODING: Color code based on the zone_type
              let parkColor = "#ff7800"; // Default Orange
              let typeDescription = park.zone_type;

              if (park.zone_type && park.zone_type.toLowerCase().includes("verbot")) {
                  parkColor = "#d32f2f"; // RED for Dog Bans (Hundeverbot)
                  typeDescription = "Dogs Prohibited (Verbot)";
              } else if (park.zone_type && park.zone_type.toLowerCase().includes("hundezone")) {
                  parkColor = "#388e3c"; // GREEN for dedicated Dog Zones
                  typeDescription = "Dedicated Dog Zone";
              }

              // Create a circle on the map for the park
              const circle = L.circleMarker([lat, lng], {
                  radius: 6,
                  fillColor: parkColor, // Use our dynamic color!
                  color: "#000",       
                  weight: 1,           
                  opacity: 1,
                  fillOpacity: 0.8
              }).addTo(map);

              // INTERACTIVITY: Add the popup
              // We use park.is_fenced === true (or 'True') to handle missing/empty values safely
              let popupContent = `<b>${park.park_name}</b><br>`;
              popupContent += `Type: ${typeDescription}<br>`;
              popupContent += `Area: ${park.area_m2 || 'Unknown'} m²<br>`;
              popupContent += `Fenced: ${park.is_fenced == true || park.is_fenced === 'True' ? 'Yes' : 'No'}<br>`;
              popupContent += `Water: ${park.has_water == true || park.has_water === 'True' ? 'Yes' : 'No'}`;
              
              circle.bindPopup(popupContent);
          }
      });
      
  })
  .catch(error => console.error("Error loading dog zones:", error));