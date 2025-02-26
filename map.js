// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoicnlhbnNlbjIxMjgiLCJhIjoiY203ZWV1cmx5MGQxbDJrb2szb2tvdzF1YyJ9.aB4o3L-t8qgzH7qA_0cf1w';
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Initialize the Mapbox map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027], // Boston
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

// Define bike lane styling
const bikeLaneStyle = {
    'line-color': 'green',
    'line-width': 3,
    'line-opacity': 0.4
};

// Time filter variable
let timeFilter = -1;

// Wait for the map to load before adding data
map.on('load', () => {
    // Add Bike Lanes (Boston & Cambridge)
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });
    map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: bikeLaneStyle
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: bikeLaneStyle
    });

    // Step 3.1: Fetch Station Data
    const stationsURL = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const trafficURL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    // Fetch both station and traffic data
    Promise.all([
        d3.json(stationsURL),
        d3.csv(trafficURL)
    ]).then(([stationData, tripData]) => {
        console.log('Loaded Station Data:', stationData);
        console.log('Loaded Trip Data:', tripData);

        // Extract station data
        let stations = stationData.data.stations;

        // Convert trip start and end times to Date objects
        tripData.forEach(trip => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
        });

        // Step 4.2: Function to update traffic data
        function updateTrafficData(trips) {
            const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
            const arrivals = d3.rollup(trips, v => v.length, d => d.end_station_id);

            return stations.map(station => {
                let id = station.short_name;
                return {
                    ...station, // Clone the station object
                    arrivals: arrivals.get(id) ?? 0,
                    departures: departures.get(id) ?? 0,
                    totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0)
                };
            });
        }

        let filteredTrips = tripData;
        let filteredStations = updateTrafficData(filteredTrips);

        // Step 3.2: Overlay SVG on the Map
        const svg = d3.select('#map')
            .append('svg')
            .style('position', 'absolute')
            .style('z-index', 1)
            .style('width', '100%')
            .style('height', '100%')
            .style('pointer-events', 'none'); 

        // Step 4.4: Floating Tooltip Fix
        const tooltip = d3.select("body")
            .append("div")
            .attr("class", "tooltip")
            .style("position", "fixed") // Prevents misalignment on scroll
            .style("background", "white")
            .style("border", "1px solid black")
            .style("padding", "5px")
            .style("border-radius", "5px")
            .style("font-size", "12px")
            .style("visibility", "hidden")
            .style("z-index", "1000"); // Ensures tooltip is on top

        // Function to get radius scale
        function getRadiusScale() {
            return d3.scaleSqrt()
                .domain([0, d3.max(filteredStations, d => d.totalTraffic)])
                .range(timeFilter === -1 ? [2, 25] : [3, 50]); // Larger circles when filtering
        }

        let radiusScale = getRadiusScale();

        // Step 3.3: Add Station Markers
        function getCoords(station) {
            const point = new mapboxgl.LngLat(+station.lon, +station.lat);
            const { x, y } = map.project(point);
            return { cx: x, cy: y };
        }

        function updateMarkers() {
            const circles = svg.selectAll("circle")
                .data(filteredStations, d => d.short_name)
                .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));
                
            circles.enter()
                .append("circle")
                .merge(circles)
                .attr("r", d => radiusScale(d.totalTraffic))
                .attr("fill", "steelblue")
                .attr("stroke", "white")
                .attr("stroke-width", 1)
                .attr("opacity", 0.6)
                .style("pointer-events", "auto")
                .style('--departure-ratio', (d) =>
                    stationFlow(d.departures / d.totalTraffic),
                  )
                .on("mouseover", function (event, d) {
                    tooltip.style("visibility", "visible")
                        .html(`<b>${d.totalTraffic} trips</b><br>
                              ${d.departures} departures<br>
                              ${d.arrivals} arrivals`)
                        .style("left", `${event.clientX + 10}px`)
                        .style("top", `${event.clientY - 20}px`);
                    
                    d3.select(this).attr("stroke-width", 2);
                })
                .on("mousemove", function (event) {
                    tooltip.style("left", `${event.clientX + 10}px`)
                           .style("top", `${event.clientY - 20}px`);
                })
                .on("mouseout", function () {
                    tooltip.style("visibility", "hidden");
                    d3.select(this).attr("stroke-width", 1);
                });

            circles.exit().remove();
        }

        function updatePositions() {
            svg.selectAll("circle")
                .attr("cx", d => getCoords(d).cx)
                .attr("cy", d => getCoords(d).cy);
        }

        updateMarkers();
        updatePositions();

        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        // Step 5.3: Time-based filtering
        function minutesSinceMidnight(date) {
            return date.getHours() * 60 + date.getMinutes();
        }

        function filterTripsByTime() {
            filteredTrips = timeFilter === -1
                ? tripData
                : tripData.filter(trip => {
                    const startedMinutes = minutesSinceMidnight(trip.started_at);
                    const endedMinutes = minutesSinceMidnight(trip.ended_at);
                    return (
                        Math.abs(startedMinutes - timeFilter) <= 60 ||
                        Math.abs(endedMinutes - timeFilter) <= 60
                    );
                });

            filteredStations = updateTrafficData(filteredTrips);
            radiusScale = getRadiusScale();
            updateMarkers();
            updatePositions();
        }

        // Step 5.2: Add interactivity for the time slider
        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        function updateTimeDisplay() {
            timeFilter = Number(timeSlider.value);
            selectedTime.textContent = timeFilter === -1 ? "" : new Date(0, 0, 0, 0, timeFilter).toLocaleTimeString('en-US', { timeStyle: 'short' });
            anyTimeLabel.style.display = timeFilter === -1 ? "inline" : "none";
            filterTripsByTime();
        }

        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();

    }).catch(error => {
        console.error('Error loading data:', error);
    });
});
