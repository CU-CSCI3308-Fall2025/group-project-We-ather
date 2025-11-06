const https = require('https');
const { URL } = require('url');

/**
 * Fetches weather data from weather.gov API
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {Promise<Object>} Weather data
 */
async function getWeatherData(lat, lon) {
  try {
    // Step 1: Get grid point from lat/lon
    const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
    const pointsData = await makeRequest(pointsUrl);
    
    if (!pointsData || !pointsData.properties) {
      throw new Error('Invalid response from points API');
    }
    
    if (!pointsData.properties.forecast) {
      throw new Error('Unable to get forecast URL from points API');
    }
    
    if (!pointsData.properties.forecastHourly) {
      throw new Error('Unable to get hourly forecast URL from points API');
    }
    
    // Step 2: Get forecast from grid point
    const forecastUrl = pointsData.properties.forecast?.trim();
    if (!forecastUrl) {
      throw new Error('Forecast URL is missing');
    }
    console.log('Forecast URL:', forecastUrl);
    
    const forecastData = await makeRequest(forecastUrl);
    
    // Step 3: Get current conditions (hourly forecast)
    const hourlyUrl = pointsData.properties.forecastHourly?.trim();
    if (!hourlyUrl) {
      throw new Error('Hourly forecast URL is missing');
    }
    console.log('Hourly URL:', hourlyUrl);
    
    const hourlyData = await makeRequest(hourlyUrl);
    
    return {
      location: pointsData.properties.relativeLocation?.properties || {
        city: 'Unknown',
        state: 'Unknown'
      },
      current: hourlyData.properties?.periods?.[0] || null,
      forecast: forecastData.properties?.periods || [],
      units: forecastData.properties?.units || {}
    };
  } catch (error) {
    console.error('Error fetching weather data:', error);
    throw error;
  }
}

async function getWeatherData2(lat, lon) {
  try {
    // Step 1: Get grid endpoint for this lat/lon
    const pointResponse = await fetch(`https://api.weather.gov/points/${lat},${lon}`);
    const pointData = await pointResponse.json();

    // The forecast URL is in the 'forecast' property
    const forecastUrl = pointData.properties.forecast;

    // Step 2: Fetch the actual forecast
    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();

    // Step 3: Display periods (each period = forecast segment)
    console.log(`Forecast for ${pointData.properties.relativeLocation.properties.city}, ${pointData.properties.relativeLocation.properties.state}`);
    forecastData.properties.periods.forEach(period => {
      console.log(`${period.name}: ${period.temperature}°${period.temperatureUnit}, ${period.shortForecast}`);
    });

  } catch (error) {
    console.error("Error fetching weather data:", error);
  }
}

/**
 * Makes an HTTPS request to weather.gov API
 * @param {string} urlString - URL to fetch
 * @returns {Promise<Object>} Parsed JSON response
 */
function makeRequest(urlString) {
  return new Promise((resolve, reject) => {
    if (!urlString) {
      return reject(new Error('URL is required'));
    }
    
    // Trim whitespace and ensure it's a string
    const trimmedUrl = String(urlString).trim();
    if (!trimmedUrl) {
      return reject(new Error('URL is empty after trimming'));
    }
    
    // Handle relative URLs by prepending the base URL
    let fullUrl = trimmedUrl;
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      fullUrl = `https://api.weather.gov${trimmedUrl.startsWith('/') ? '' : '/'}${trimmedUrl}`;
    }
    
    let url;
    try {
      url = new URL(fullUrl);
    } catch (error) {
      console.error('URL parsing error:', { original: urlString, trimmed: trimmedUrl, fullUrl });
      return reject(new Error(`Invalid URL: ${urlString} - ${error.message}`));
    }
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'We-ather App (contact: your-email@example.com)',
        'Accept': 'application/json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(makeRequest(res.headers.location));
      }
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

module.exports = {
  getWeatherData
};

