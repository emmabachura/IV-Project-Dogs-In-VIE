// Initialize the map, center it on Vienna, and set the zoom to 12
const map = L.map('map').setView([48.2082, 16.3738], 12);
let activeDistrictClick = null;
let districtLayer;
let zbLayer;
let isHeatmapVisible = false;
let markerLayer = L.layerGroup().addTo(map);
let allDogZones = [];
let districtMetrics = [];
let zaehlbezirkMetrics = [];
let heatmapColorScale = null;
let hoveredSubdistrictId = null;
let districtColorScale = null;
let districtMetricsById = {};
const districtLayersById = {};

const chartTitle = document.getElementById('chart-title');
const chartDescription = document.getElementById('chart-description');
const areaFilter = document.getElementById('area-filter');
const toggleHeatmapButton = document.getElementById('toggle-heatmap');
const legendDescription = document.getElementById('legend-description');
const legendContent = document.getElementById('legend-content');
const waterFilter = document.getElementById('water-filter');
const fencedFilter = document.getElementById('fenced-filter');
const zoneTypeFilter = document.getElementById('zone-type-filter');
const zbLayersById = {};

function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const UI_COLORS = {
    districtStroke: getCssVar('--district-stroke'),
    districtFill: getCssVar('--district-fill'),
    heatmapStroke: getCssVar('--heatmap-stroke'),
    zoneDedicated: getCssVar('--zone-dedicated'),
    zoneGeneral: getCssVar('--zone-general'),
    zoneProhibited: getCssVar('--zone-prohibited'),
    waterOutline: getCssVar('--water-outline'),
    hoverHighlight: getCssVar('--hover-highlight'),
    mapOutline: getCssVar('--map-outline'),
    accentDark: getCssVar('--accent-dark'),
    heatmapEmpty: getCssVar('--heatmap-empty')
};

const DISTRICT_CHOROPLETH_FIELD = 'space_per_dog_m2';
const DISTRICT_CHOROPLETH_LABEL = 'Dog-zone area per registered dog';

function getDistrictMetricValue(metrics) {
    const value = metrics ? Number(metrics[DISTRICT_CHOROPLETH_FIELD]) : NaN;
    return Number.isFinite(value) ? value : NaN;
}

function getDistrictFillColor(metrics) {
    const metricValue = getDistrictMetricValue(metrics);

    if (!Number.isFinite(metricValue) || !districtColorScale) {
        return UI_COLORS.districtFill;
    }

    return districtColorScale(metricValue);
}

function getDistrictStyle(feature) {
    const districtNumber = Number(feature.properties.BEZNR || '');
    const metrics = districtMetricsById[districtNumber];
    const hasMetric = Number.isFinite(getDistrictMetricValue(metrics));

    return {
        color: UI_COLORS.districtStroke,
        weight: 1,
        fillColor: getDistrictFillColor(metrics),
        fillOpacity: hasMetric ? 0.68 : 0.22
    };
}

function setDistrictHighlight(districtId, isHighlighted) {
    const layer = districtLayersById[districtId];

    if (!layer) {
        return;
    }

    const baseStyle = getDistrictStyle(layer.feature);
    layer.setStyle({
        ...baseStyle,
        weight: isHighlighted ? 3 : baseStyle.weight,
        color: isHighlighted ? UI_COLORS.accentDark : baseStyle.color,
        fillOpacity: isHighlighted ? 0.84 : baseStyle.fillOpacity
    });
}

function applyDistrictPointSelection() {
    const dots = d3.selectAll('.dot');

    if (activeDistrictClick === null) {
        dots
            .transition().duration(300)
            .style('opacity', 0.88)
            .attr('r', 7)
            .style('pointer-events', 'all')
            .style('stroke', UI_COLORS.mapOutline)
            .style('stroke-width', 1.2);
        return;
    }

    dots
        .transition().duration(300)
        .style('opacity', d => Number(d.district) === activeDistrictClick ? 1 : 0.08)
        .attr('r', d => Number(d.district) === activeDistrictClick ? 10 : 4)
        .style('pointer-events', d => Number(d.district) === activeDistrictClick ? 'all' : 'none')
        .style('stroke', d => Number(d.district) === activeDistrictClick ? UI_COLORS.hoverHighlight : UI_COLORS.mapOutline)
        .style('stroke-width', d => Number(d.district) === activeDistrictClick ? 3 : 1);
}

function toggleActiveDistrictSelection(districtNumber) {
    const previousSelection = activeDistrictClick;

    if (previousSelection !== null && previousSelection !== districtNumber) {
        setDistrictHighlight(previousSelection, false);
    }

    if (activeDistrictClick === districtNumber) {
        activeDistrictClick = null;
        setDistrictHighlight(districtNumber, false);

        const layer = districtLayersById[districtNumber];
        if (layer) {
            layer.closePopup();
        }
    } else {
        activeDistrictClick = districtNumber;
        setDistrictHighlight(districtNumber, true);

        const layer = districtLayersById[districtNumber];
        if (layer) {
            layer.openPopup();
        }
    }

    applyDistrictPointSelection();
}

function hasWater(value) {
    return value == true || value === 'True';
}

function isFullyFenced(value) {
    return value === 'yes' || value === true || value === 'True';
}

function getFencedCategory(value) {
    if (value === 'partially') {
        return 'partially';
    }
    if (isFullyFenced(value)) {
        return 'yes';
    }
    return 'no';
}

function getZoneTypePresentation(zoneType) {
    if (zoneType && zoneType.toLowerCase().includes('hundezone')) {
        return {
            color: UI_COLORS.zoneDedicated,
            label: 'Dedicated Dog Zone'
        };
    }

    if (zoneType && zoneType.toLowerCase().includes('verbot')) {
        return {
            color: UI_COLORS.zoneProhibited,
            label: 'Restricted Area'
        };
    }

    return {
        color: UI_COLORS.zoneGeneral,
        label: 'General Dog Area'
    };
}

function matchesZoneFilters(park, selectedMinArea) {
    const area = parseFloat(park.area_m2);
    if (!(area >= selectedMinArea)) {
        return false;
    }

    if (waterFilter.value === 'yes' && !hasWater(park.has_water)) {
        return false;
    }
    if (waterFilter.value === 'no' && hasWater(park.has_water)) {
        return false;
    }

    if (fencedFilter.value !== 'all' && getFencedCategory(park.is_fenced) !== fencedFilter.value) {
        return false;
    }

    const zoneType = getZoneTypePresentation(park.zone_type);
    if (zoneTypeFilter.value === 'dedicated' && zoneType.label !== 'Dedicated Dog Zone') {
        return false;
    }
    if (zoneTypeFilter.value === 'general' && zoneType.label !== 'General Dog Area') {
        return false;
    }

    return true;
}

function createLegendItem({ swatchClass = '', swatchStyle = '', label, note = '' }) {
    const styleAttribute = swatchStyle ? ` style="${swatchStyle}"` : '';

    return `
        <div class="legend-item">
            <span class="legend-swatch ${swatchClass}"${styleAttribute}></span>
            <div>
                <div class="legend-label">${label}</div>
                ${note ? `<div class="legend-note">${note}</div>` : ''}
            </div>
        </div>
    `;
}

function updateLegend() {
    if (!legendDescription || !legendContent) {
        return;
    }

    if (isHeatmapVisible) {
        const maxScore = d3.max(zaehlbezirkMetrics, d => Number(d.infra_score)) || 0;

        legendDescription.textContent = 'Green tones show stronger infrastructure scores across sub-districts.';
        legendContent.innerHTML = `
            <div class="legend-group">
                <div class="legend-group-title">Heatmap Scale</div>
                <div class="legend-gradient"></div>
                <div class="legend-range">
                    <span>Low score</span>
                    <span>High score (${Math.round(maxScore)})</span>
                </div>
                ${createLegendItem({
                    swatchStyle: `background:${UI_COLORS.heatmapEmpty};`,
                    label: 'No dog zones or no score',
                    note: 'Pink areas have no dog zones or no usable score.'
                })}
            </div>
        `;
        return;
    }

    const maxDistrictMetric = d3.max(Object.values(districtMetricsById), getDistrictMetricValue) || 0;
    const midDistrictMetric = maxDistrictMetric / 2;
    const districtGradientStyle = districtColorScale
        ? `background:linear-gradient(90deg, ${districtColorScale(0)} 0%, ${districtColorScale(midDistrictMetric)} 50%, ${districtColorScale(maxDistrictMetric)} 100%);`
        : '';

    legendDescription.textContent = 'District colors show available dog-zone area per registered dog, while point markers summarize each district.';
    legendContent.innerHTML = `
        <div class="legend-group">
            <div class="legend-group-title">District Choropleth</div>
            <div class="legend-gradient" style="${districtGradientStyle}"></div>
            <div class="legend-range">
                <span>Lower access</span>
                <span>Higher access (${maxDistrictMetric.toFixed(1)} m²/dog)</span>
            </div>
            ${createLegendItem({
                swatchStyle: `background:${UI_COLORS.districtFill};`,
                label: 'No district metric',
                note: 'Neutral fill means no usable district value is available.'
            })}
        </div>
        <div class="legend-group">
            <div class="legend-group-title">Zone Type</div>
            ${createLegendItem({ swatchStyle: `background:${UI_COLORS.zoneDedicated};`, label: 'Dedicated dog zone' })}
            ${createLegendItem({ swatchStyle: `background:${UI_COLORS.zoneGeneral};`, label: 'General dog area' })}
        </div>
    `;
}

function updateModeUIState() {
    document.body.classList.toggle('mode-heatmap', isHeatmapVisible);
    toggleHeatmapButton.classList.toggle('is-active', isHeatmapVisible);
    toggleHeatmapButton.setAttribute('aria-pressed', isHeatmapVisible ? 'true' : 'false');
}

function updateChartPanelText() {
    updateModeUIState();
    updateLegend();

    if (isHeatmapVisible) {
        chartTitle.textContent = 'Top 10 Sub-districts';
        chartDescription.textContent = 'Ranked by the current infrastructure score.';
        areaFilter.style.display = 'none';
        return;
    }

    chartTitle.textContent = 'District Dog Zone Area vs. Registered Dogs';
    chartDescription.textContent = 'Each point summarizes one district using total dog-zone area and registered dogs.';
    areaFilter.style.display = '';
}

function renderActiveChart() {
    updateChartPanelText();

    if (isHeatmapVisible) {
        if (zaehlbezirkMetrics.length > 0) {
            drawTopSubdistrictChart(zaehlbezirkMetrics);
        }
        return;
    }

    if (districtMetrics.length > 0) {
        drawDistrictScatterplot(districtMetrics);
    }
}

function setSubdistrictHighlight(zbezId, isHighlighted) {
    const layer = zbLayersById[zbezId];

    if (!layer) {
        return;
    }

    layer.setStyle({
        weight: isHighlighted ? 3 : 1,
        color: isHighlighted ? UI_COLORS.accentDark : UI_COLORS.heatmapStroke,
        fillOpacity: isHighlighted ? 0.82 : 0.6
    });

    if (isHighlighted) {
        layer.bringToFront();
    }
}

function clearHoveredSubdistrict() {
    if (hoveredSubdistrictId === null) {
        return;
    }

    setSubdistrictHighlight(hoveredSubdistrictId, false);
    hoveredSubdistrictId = null;
}

function setHoveredSubdistrict(zbezId) {
    if (hoveredSubdistrictId !== null && hoveredSubdistrictId !== zbezId) {
        setSubdistrictHighlight(hoveredSubdistrictId, false);
    }

    hoveredSubdistrictId = zbezId;
    setSubdistrictHighlight(zbezId, true);
}

map.on('popupclose', function () {
    if (activeDistrictClick !== null) {
        setDistrictHighlight(activeDistrictClick, false);
        activeDistrictClick = null;
        applyDistrictPointSelection();
    }
});

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
        districtMetrics = metricsData;
        districtMetricsById = metricsByDistrict;

        const maxDistrictMetric = d3.max(metricsData, getDistrictMetricValue) || 1;
        districtColorScale = d3.scaleSequential(d3.interpolateYlGn)
            .domain([0, maxDistrictMetric]);

        districtLayer = L.geoJSON(districtData, {
            interactive: true,
            style: getDistrictStyle,
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
                districtLayersById[districtNumber] = layer;
                let popupContent = `
                <b>${districtName}</b><br>
                District: ${districtNumber}<br>
            `;
                if (metrics) {
                    const spacePerDog = getDistrictMetricValue(metrics);
                    popupContent += `
                    <hr>
                    <b>District Access Metric</b><br>
                    ${DISTRICT_CHOROPLETH_LABEL}: ${spacePerDog.toFixed(1)} m²<br>
                    <hr>
                    <b>Dog Statistics</b><br>
                    Registered dogs: ${metrics.dog_count}<br>
                    Small dogs: ${metrics.small_dog_count} (${metrics.small_dog_percent.toFixed(1)}%)<br>
                    Medium dogs: ${metrics.medium_dog_count} (${metrics.medium_dog_percent.toFixed(1)}%)<br>
                    Large dogs: ${metrics.large_dog_count} (${metrics.large_dog_percent.toFixed(1)}%)<br>
                    Unknown size: ${metrics.unknown_dog_count} (${metrics.unknown_dog_percent.toFixed(1)}%)<br>
                    <hr>
                    <b>Dog Zone Statistics</b><br>
                    Total dog zones: ${metrics.zone_count}<br>
                    Total dog zone area: ${Math.round(metrics.total_zone_area_m2).toLocaleString()} m²<br>
                    Space per dog: ${metrics.space_per_dog_m2.toFixed(1)} m²<br>
                    Fenced zones: ${metrics.fenced_zones}<br>
                    Partially fenced zones: ${metrics.partially_fenced_zones}<br>
                    Water zones: ${metrics.water_zones}<br>
                `;
                } else {
                    popupContent += `
                    <hr>
                    No metrics available for this district.
                `;
                }
                layer.bindPopup(popupContent);
                layer.on("mouseover", function () {
                    setDistrictHighlight(districtNumber, true);
                });
                layer.on("mouseout", function () {
                    if (activeDistrictClick !== districtNumber) {
                        setDistrictHighlight(districtNumber, false);
                    }
                });
                layer.on("click", function () {
                    toggleActiveDistrictSelection(districtNumber);
                });
            }
        }).addTo(map);
        districtLayer.bringToBack();
        map.fitBounds(districtLayer.getBounds());
        updateLegend();
        renderActiveChart();
    })
    .catch(error => console.error("Error loading districts or metrics:", error));

const leafletMarkers = {};

fetch('/api/zones')
    .then(response => {
        if (!response.headers.get("content-type").includes("application/json")) {
            throw new Error("Backend is not sending JSON. Check your Flask app.py!");
        }
        return response.json();
    })
    .then(data => {

        const validData = data.filter(park =>
            park.latitude && !isNaN(parseFloat(park.latitude)) &&
            park.area_m2 && !isNaN(parseFloat(park.area_m2)) &&
            !(park.zone_type && park.zone_type.toLowerCase().includes("verbot"))
        );

        validData.forEach(park => {
            const lat = parseFloat(park.latitude);
            const lng = parseFloat(park.longitude);
            const zoneType = getZoneTypePresentation(park.zone_type);

            const circle = L.circleMarker([lat, lng], {
                radius: 6,
                fillColor: zoneType.color,
                color: UI_COLORS.mapOutline,
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(markerLayer);

            let popupContent = `<b>${park.park_name}</b><br>`;
            popupContent += `Type: ${zoneType.label}<br>`;
            popupContent += `Area: ${park.area_m2 || 'Unknown'} m²<br>`;
            popupContent += `Fenced: ${park.is_fenced == true || park.is_fenced === 'True' ? 'Yes' : 'No'}<br>`;
            popupContent += `Water available: ${hasWater(park.has_water) ? 'Yes' : 'No'}`;

            circle.bindPopup(popupContent);
            leafletMarkers[park.object_id] = circle;

            circle.on('mouseover', function () {
                this.setStyle({color: UI_COLORS.hoverHighlight, weight: 5});
                this.openPopup();

                d3.select("#dot-" + park.object_id)
                    .style("opacity", 1)
                    .attr("r", 10)
                    .style("stroke", UI_COLORS.hoverHighlight)
                    .style("stroke-width", 3);
            });

            circle.on('mouseout', function () {
                this.setStyle({color: UI_COLORS.mapOutline, weight: 1});
                this.closePopup();

                const parkHasWater = hasWater(park.has_water);

                d3.select("#dot-" + park.object_id)
                    .style("opacity", 0.8)
                    .attr("r", 6)
                    .style("stroke", parkHasWater ? UI_COLORS.waterOutline : UI_COLORS.mapOutline)
                    .style("stroke-width", parkHasWater ? 2.5 : 1);
            });
        });

        allDogZones = validData;
        renderActiveChart();

        // AREA SLIDER: one slider step = one unique dog-zone area value
        uniqueAreaValues = [...new Set(
            validData
                .map(d => Math.round(parseFloat(d.area_m2)))
                .filter(v => !isNaN(v))
        )].sort((a, b) => a - b);

        const areaSlider = document.getElementById("area-slider");
        const areaSummary = document.getElementById("area-filter-summary");

        areaSlider.min = 0;
        areaSlider.max = uniqueAreaValues.length - 1;
        areaSlider.step = 1;
        areaSlider.value = 0;

        function updateAreaFilter() {
            const selectedIndex = Number(areaSlider.value);
            const selectedMinArea = uniqueAreaValues[selectedIndex];

            let visibleCount = 0;

            validData.forEach(park => {
            const isVisible = matchesZoneFilters(park, selectedMinArea);
                const marker = leafletMarkers[park.object_id];

                if (marker) {
                    if (isVisible) {
                        if (!markerLayer.hasLayer(marker)) {
                            marker.addTo(markerLayer);
                        }
                    } else {
                        if (markerLayer.hasLayer(marker)) {
                            markerLayer.removeLayer(marker);
                        }
                    }
                }

                d3.select("#dot-" + park.object_id)
                    .style("display", isVisible ? null : "none");

                if (isVisible) {
                    visibleCount += 1;
                }
            });

            areaSummary.textContent =
                `${visibleCount} of ${validData.length} dog zones match the current filters and are ${selectedMinArea.toLocaleString()} m² or larger.`;
        }

        areaSlider.addEventListener("input", updateAreaFilter);
        waterFilter.addEventListener('change', updateAreaFilter);
        fencedFilter.addEventListener('change', updateAreaFilter);
        zoneTypeFilter.addEventListener('change', updateAreaFilter);
        updateAreaFilter();

    })
    .catch(error => console.error("Error loading dog zones:", error));

function drawScatterplot(data, markers) {
    // 1. Set up dimensions
    const container = document.getElementById("scatterplot");
    const margin = {top: 20, right: 20, bottom: 50, left: 50};
    const outerWidth = container.clientWidth || 400;
    const width = Math.max(outerWidth - margin.left - margin.right, 220);
    const height = 400 - margin.top - margin.bottom;

    d3.select("#scatterplot").selectAll("*").remove();

    const svg = d3.select("#scatterplot")
        .append("svg")
        .attr("width", outerWidth)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // 2. Set up Scales
    const xScale = d3.scaleLog()
        .domain([10, d3.max(data, d => parseFloat(d.area_m2))])
        .range([0, width]);

    // CHANGED: Y-Axis now uses the district dog count. 
    // (Multiplying by 1.1 adds 10% padding to the top of the chart so dots don't hit the ceiling)
    const yScale = d3.scaleLinear()
        .domain([0, d3.max(data, d => parseFloat(d.district_dog_count)) * 1.1])
        .range([height, 0]);

    // 3. Draw Axes
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(5, "~s"));

    svg.append("g")
        .call(d3.axisLeft(yScale).ticks(5));

    // Axis Labels
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", height + 40)
        .style("text-anchor", "middle")
        .text("Park Area (m²) - Log Scale");

    // CHANGED: Updated Y-Axis Label
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -40)
        .attr("x", -height / 2)
        .style("text-anchor", "middle")
        .text("Total Registered Dogs in District");

    // 4. Draw the Dots!
    svg.selectAll(".dot")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", "dot")
        .attr("id", d => "dot-" + d.object_id)
        .attr("cx", d => xScale(parseFloat(d.area_m2)))
        // CHANGED: Plot the Y-coordinate using the district dog count
        .attr("cy", d => yScale(parseFloat(d.district_dog_count)))
        .attr("r", 6)
        .style("fill", d => {
            return getZoneTypePresentation(d.zone_type).color;
        })
        .style("opacity", 0.8)
        // VISUAL ENCODING: Highlight parks that have water with a bright blue border!
        .style("stroke", d => hasWater(d.has_water) ? UI_COLORS.waterOutline : UI_COLORS.mapOutline)
        .style("stroke-width", d => hasWater(d.has_water) ? 2.5 : 1)

        // 5. BRUSHING AND LINKING
        .on("mouseover", function (event, d) {
            d3.select(this)
                .style("opacity", 1)
                .attr("r", 10)
                .style("stroke", UI_COLORS.hoverHighlight)
                .style("stroke-width", 3);

            const linkedMarker = markers[d.object_id];
            if (linkedMarker) {
                linkedMarker.setStyle({color: UI_COLORS.hoverHighlight, weight: 5});
                linkedMarker.openPopup();
            }
        })
        .on("mouseout", function (event, d) {
            d3.select(this)
                .style("opacity", 0.8)
                .attr("r", 6)
                // Reset the stroke back to blue (if it has water) or black (if no water)
                .style("stroke", hasWater(d.has_water) ? UI_COLORS.waterOutline : UI_COLORS.mapOutline)
                .style("stroke-width", hasWater(d.has_water) ? 2.5 : 1);

            const linkedMarker = markers[d.object_id];
            if (linkedMarker) {
                linkedMarker.setStyle({color: UI_COLORS.mapOutline, weight: 1});
                linkedMarker.closePopup();
            }
        });
}

function drawDistrictScatterplot(data) {
    const container = document.getElementById('scatterplot');
    const margin = {top: 20, right: 20, bottom: 55, left: 72};
    const outerWidth = container.clientWidth || 400;
    const width = Math.max(outerWidth - margin.left - margin.right, 220);
    const height = 400 - margin.top - margin.bottom;

    d3.select('#scatterplot').selectAll('*').remove();

    const plotData = data
        .filter(d => Number.isFinite(Number(d.dog_count)) && Number.isFinite(Number(d.total_zone_area_m2)))
        .map(d => ({
            ...d,
            district: Number(d.district),
            dog_count: Number(d.dog_count),
            total_zone_area_m2: Number(d.total_zone_area_m2)
        }))
        .filter(d => !isNaN(d.district));

    const svg = d3.select('#scatterplot')
        .append('svg')
        .attr('width', outerWidth)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleLinear()
        .domain([0, d3.max(plotData, d => d.dog_count) * 1.08])
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([0, d3.max(plotData, d => d.total_zone_area_m2) * 1.08])
        .range([height, 0]);

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(5, '~s'));

    svg.append('g')
        .call(d3.axisLeft(yScale).ticks(5, '~s'));

    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 42)
        .style('text-anchor', 'middle')
        .text('Registered dogs');

    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', -50)
        .attr('x', -height / 2)
        .style('text-anchor', 'middle')
        .text('Total dog-zone area (m²)');

    svg.selectAll('.district-dot')
        .data(plotData)
        .enter()
        .append('circle')
        .attr('class', 'dot district-dot')
        .attr('id', d => `district-dot-${d.district}`)
        .attr('cx', d => xScale(d.dog_count))
        .attr('cy', d => yScale(d.total_zone_area_m2))
        .attr('r', 7)
        .style('fill', d => getDistrictFillColor(d))
        .style('opacity', 0.88)
        .style('stroke', UI_COLORS.mapOutline)
        .style('stroke-width', 1.2)
        .on('mouseover', function (event, d) {
            d3.select(this)
                .style('opacity', 1)
                .attr('r', 10)
                .style('stroke', UI_COLORS.hoverHighlight)
                .style('stroke-width', 3);

            setDistrictHighlight(d.district, true);
        })
        .on('mouseout', function (event, d) {
            d3.select(this)
                .style('opacity', activeDistrictClick === d.district ? 1 : 0.88)
                .attr('r', activeDistrictClick === d.district ? 10 : 7)
                .style('stroke', activeDistrictClick === d.district ? UI_COLORS.hoverHighlight : UI_COLORS.mapOutline)
                .style('stroke-width', activeDistrictClick === d.district ? 3 : 1.2);

            if (activeDistrictClick !== d.district) {
                setDistrictHighlight(d.district, false);
            }
        })
        .on('click', function (event, d) {
            toggleActiveDistrictSelection(d.district);
        });
}

function drawTopSubdistrictChart(data) {
    const container = document.getElementById('scatterplot');
    const margin = {top: 20, right: 50, bottom: 40, left: 130};
    const outerWidth = container.clientWidth || 400;
    const width = Math.max(outerWidth - margin.left - margin.right, 220);
    const height = 400 - margin.top - margin.bottom;

    d3.select('#scatterplot').selectAll('*').remove();

    const topSubdistricts = [...data]
        .filter(d => !isNaN(Number(d.infra_score)))
        .sort((a, b) => Number(b.infra_score) - Number(a.infra_score))
        .slice(0, 10)
        .reverse();

    const svg = d3.select('#scatterplot')
        .append('svg')
        .attr('width', outerWidth)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleLinear()
        .domain([0, d3.max(topSubdistricts, d => Number(d.infra_score)) * 1.1])
        .range([0, width]);

    const yScale = d3.scaleBand()
        .domain(topSubdistricts.map(d => `Sub-district ${Number(d.ZBEZ)}`))
        .range([height, 0])
        .padding(0.18);

    svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale).ticks(5));

    svg.append('g')
        .call(d3.axisLeft(yScale));

    svg.append('text')
        .attr('x', width / 2)
        .attr('y', height + 35)
        .style('text-anchor', 'middle')
        .text('Infrastructure score');

    svg.selectAll('.top-bar')
        .data(topSubdistricts)
        .enter()
        .append('rect')
        .attr('class', 'top-bar')
        .attr('x', 0)
        .attr('y', d => yScale(`Sub-district ${Number(d.ZBEZ)}`))
        .attr('width', d => xScale(Number(d.infra_score)))
        .attr('height', yScale.bandwidth())
        .attr('fill', d => heatmapColorScale ? heatmapColorScale(Number(d.infra_score)) : '#90be6d')
        .on('mouseover', function (event, d) {
            d3.select(this).attr('fill', UI_COLORS.accentDark);
            setSubdistrictHighlight(Number(d.ZBEZ), true);
        })
        .on('mouseout', function (event, d) {
            d3.select(this)
                .attr('fill', heatmapColorScale ? heatmapColorScale(Number(d.infra_score)) : '#90be6d');
            setSubdistrictHighlight(Number(d.ZBEZ), false);
        });

    svg.selectAll('.score-label')
        .data(topSubdistricts)
        .enter()
        .append('text')
        .attr('class', 'score-label')
        .attr('x', d => xScale(Number(d.infra_score)) + 8)
        .attr('y', d => (yScale(`Sub-district ${Number(d.ZBEZ)}`) || 0) + (yScale.bandwidth() / 2) + 4)
        .style('font-size', '12px')
        .text(d => `${Math.round(Number(d.infra_score))}`);
}

Promise.all([
    fetch("/api/zaehlbezirke_shapes").then(res => res.json()),
    fetch("/api/zaehlbezirk_metrics").then(res => res.json())
]).then(([zbShapes, zbMetrics]) => {
    zaehlbezirkMetrics = zbMetrics.map(row => {
        const zbKey = row.ZBEZ_district ?? row.ZBEZ_right ?? row.ZBEZ ?? row.ZBEZNR ?? row.ZBEZNR_right;
        return {
            ...row,
            ZBEZ: Number(zbKey)
        };
    }).filter(row => !isNaN(row.ZBEZ));

    // Map the metrics by ZBEZ ID for fast lookup
    const metricsByZb = {};
    zaehlbezirkMetrics.forEach(row => {
        // Find the correct column name and FORCE it to a standard Number to drop leading zeros
        metricsByZb[row.ZBEZ] = row;
    });

    // Create a D3 Color Scale for the Heatmap
    const maxScore = d3.max(zaehlbezirkMetrics, d => Number(d.infra_score)) || 100;
    heatmapColorScale = d3.scaleSequential(d3.interpolateYlGn)
        .domain([0, maxScore]);

    // Draw the 250 tracts on Leaflet
    zbLayer = L.geoJSON(zbShapes, {
        style: function (feature) {
            const rawId = feature.properties.ZBEZ || feature.properties.ZBEZNR;
            const zbezId = Number(rawId);
            const metrics = metricsByZb[zbezId];

            const score = metrics ? metrics.infra_score : 0;

            const resolvedFillColor = score > 0 ? heatmapColorScale(score) : UI_COLORS.heatmapEmpty;

            return {
                color: UI_COLORS.heatmapStroke,
                weight: 1,
                fillColor: resolvedFillColor,
                fillOpacity: 0.6
            };
        },
        onEachFeature: function (feature, layer) {
            const rawId = feature.properties.ZBEZ || feature.properties.ZBEZNR;
            const zbezId = Number(rawId);
            const metrics = metricsByZb[zbezId];
            zbLayersById[zbezId] = layer;

            layer.on('mouseover', function () {
                setHoveredSubdistrict(zbezId);
            });

            layer.on('mouseout', function () {
                if (hoveredSubdistrictId === zbezId) {
                    clearHoveredSubdistrict();
                }
            });

            if (metrics) {
                layer.bindPopup(`
                    <b>Sub-district ${zbezId}</b><br>
                    Infrastructure Rank: #${metrics.infra_rank}<br>
                    Infrastructure score: ${Math.round(metrics.infra_score)}<br>
                    Total dog zones: ${metrics.zone_count}
                `);
            } else {
                layer.bindPopup(`<b>Sub-district ${zbezId}</b><br>No dog zones here.`);
            }
        }
    });

    renderActiveChart();
    updateLegend();
});

map.getContainer().addEventListener('mouseleave', function () {
    clearHoveredSubdistrict();
});


document.getElementById('toggle-heatmap').addEventListener('click', function () {
    if (!districtLayer || !zbLayer) {
        console.warn("Map layers are still loading!");
        return;
    }

    isHeatmapVisible = !isHeatmapVisible;

    if (isHeatmapVisible) {
        // Switch to Heatmap
        map.removeLayer(districtLayer);
        map.addLayer(zbLayer);
        map.removeLayer(markerLayer);   // <--- NEW: Hide the dots!
        this.innerText = "District View";
    } else {
        // Switch to Districts
        map.removeLayer(zbLayer);
        map.addLayer(districtLayer);
        map.addLayer(markerLayer);      // <--- NEW: Bring the dots back!
        this.innerText = "Heatmap View";
    }

    renderActiveChart();

    requestAnimationFrame(() => {
        map.invalidateSize();
    });
});

updateModeUIState();