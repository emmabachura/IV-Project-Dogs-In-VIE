// Initialize the map, center it on Vienna, and set the zoom to 12
const map = L.map('map').setView([48.2082, 16.3738], 12);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd'
}).addTo(map);

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