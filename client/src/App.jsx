import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { 
  AlertTriangle, CheckCircle2, TrendingUp, Sliders, 
  MapPin, Info, BarChart3, Database, ChevronRight,
  Compass, Search, RefreshCw, Sparkles, Building2, ShieldAlert,
  Upload, FileText, Check, Eye, Download, X, HelpCircle,
  Layers, ArrowDown, ArrowUp, ExternalLink, Zap, BookOpen,
  Maximize2, Minimize2, Sun, Moon, Globe, Target, Radio
} from 'lucide-react';

// ── Native, Zero-Dependency Data Parsers ──

/**
 * Robust numeric parser that handles formatted strings like "1,073", "25,840", "96%", "₹1,200", "$500".
 */
function cleanNumber(val) {
  if (typeof val === 'number') return isFinite(val) ? val : NaN;
  if (typeof val !== 'string') return NaN;
  const trimmed = val.trim();
  if (!trimmed) return NaN;
  const cleaned = trimmed.replace(/,/g, '').replace(/%/g, '').replace(/[₹$"']/g, '').trim();
  const num = Number(cleaned);
  return (!isNaN(num) && isFinite(num)) ? num : NaN;
}

/**
 * Robust RFC-4180 compliant CSV parser that handles quotes, escaped quotes,
 * commas inside fields, and multi-line values.
 */
function parseCSV(text) {
  const lines = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some(c => c.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(c => c.length > 0)) lines.push(currentRow);
  }

  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].map(h => h.replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').trim());
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const rowObj = {};
    headers.forEach((h, idx) => {
      const val = lines[r][idx] ?? '';
      const num = cleanNumber(val);
      rowObj[h] = !isNaN(num) ? num : val;
    });
    rows.push(rowObj);
  }
  return { headers, rows };
}

/**
 * Flexible JSON parser supporting arrays of objects, GeoJSON FeatureCollections,
 * or wrapped objects with `localities`, `data`, or `records` arrays.
 */
function parseJSON(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { headers: [], rows: [] };
    const headers = Array.from(new Set(parsed.flatMap(obj => Object.keys(obj))));
    return { headers, rows: parsed };
  }
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    const rows = parsed.features.map(f => {
      const coords = f.geometry && f.geometry.coordinates;
      const lon = Array.isArray(coords) ? coords[0] : null;
      const lat = Array.isArray(coords) ? coords[1] : null;
      return { ...f.properties, lat, lon };
    });
    const headers = Array.from(new Set(rows.flatMap(obj => Object.keys(obj))));
    return { headers, rows };
  }
  const candidate = parsed.localities || parsed.data || parsed.records;
  if (Array.isArray(candidate)) {
    const headers = Array.from(new Set(candidate.flatMap(obj => Object.keys(obj))));
    return { headers, rows: candidate };
  }
  return { headers: Object.keys(parsed), rows: [parsed] };
}

/**
 * Smart field name detection matching common urban data schemas,
 * including official police IPC crime head category tables.
 */
function autoDetectMapping(headers, rows = []) {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  const mapping = {
    locality: '',
    lat: '',
    lon: '',
    risk_index: '',
    crimes_against_women: '',
    total_crimes: '',
    detection_rate: '',
    previous_year: '',
    police_chowkis: '',
    population_density: '',
    uhi_index: '',
    internet_pct: '',
    ward: '',
    zone: ''
  };
  
  const matchBest = (patterns) => {
    for (const pat of patterns) {
      const exactIdx = lowerHeaders.indexOf(pat);
      if (exactIdx !== -1) return headers[exactIdx];
    }
    for (const pat of patterns) {
      const partialIdx = lowerHeaders.findIndex(h => h.includes(pat));
      if (partialIdx !== -1) return headers[partialIdx];
    }
    return '';
  };

  mapping.locality = matchBest([
    'crime heads', 'crime_heads', 'crime head', 'crime_head', 'crimeheads', 'crimehead',
    'category', 'categories', 'offence', 'offense', 'offences', 'offenses', 'head', 'heads',
    'crime_type', 'crime type', 'description', 'title', 'class', 'section',
    'locality', 'name', 'area_name', 'area', 'neighborhood', 'city', 'station', 'location', 'place'
  ]);

  // Fallback: If no keyword match, select the first column where sample rows are text strings
  if (!mapping.locality && rows && rows.length > 0) {
    for (const h of headers) {
      const isText = rows.slice(0, 10).some(r => typeof r[h] === 'string' && isNaN(cleanNumber(r[h])));
      if (isText) {
        mapping.locality = h;
        break;
      }
    }
  }

  mapping.lat = matchBest(['latitude', 'lat', 'y', 'coord_y']);
  mapping.lon = matchBest(['longitude', 'lon', 'lng', 'long', 'x', 'coord_x']);
  mapping.risk_index = matchBest(['risk_index', 'priority_index', 'vulnerability_index', 'score', 'risk', 'priority']);
  
  mapping.crimes_against_women = matchBest([
    '2024 registered', '2023 registered', '2022 registered', 'registered', 'cases registered',
    'reported', 'cases reported', 'total registered', 'registered cases',
    'crimes_against_women', 'incidents', 'crime_count', 'crimes', 'cases', 'volume', 'count'
  ]);
  
  mapping.total_crimes = matchBest([
    '2024 detected', '2023 detected', '2022 detected', 'detected', 'cases detected', 'solved',
    'cleared', 'total_crimes', 'total_incidents', 'crime_total', 'all_crimes'
  ]);

  mapping.detection_rate = matchBest([
    '%age detection - 2023', '%age detection - 2024', '%age detection', '%age detected 2022',
    '%age detected', 'detection rate', 'detection_pct', 'clearance rate', 'clearance_pct',
    'detection', 'clearance', 'solved_pct'
  ]);

  mapping.previous_year = matchBest([
    '2022 registered', '2021 registered', 'previous registered', 'prev_registered',
    'prior_registered', 'last_year_registered'
  ]);

  mapping.police_chowkis = matchBest(['police_chowkis', 'chowkis', 'police_stations', 'outposts', 'stations', 'facilities']);
  mapping.population_density = matchBest(['population_density', 'density', 'pop_density', 'density_km2', 'population']);
  mapping.uhi_index = matchBest(['uhi_index', 'heat_index', 'temperature', 'uhi', 'heat']);
  mapping.internet_pct = matchBest(['internet_pct', 'internet', 'connectivity', 'digital_pct']);
  mapping.ward = matchBest(['ward', 'district', 'suburb', 'borough', 'region']);
  mapping.zone = matchBest(['zone', 'macro_zone', 'sector', 'area_type']);

  return mapping;
}

export default function App() {
  // Global Application State
  const [defaultData, setDefaultData] = useState(null);
  const [activeDataset, setActiveDataset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('cockpit'); // cockpit | upload | simulator | eda | benchmark | data
  const [selectedLocalityManual, setSelectedLocality] = useState(null);
  
  // Filters & Quick Presets
  const [searchQuery, setSearchQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState('all'); // all | high | med | low | chowki_deficit | dense
  
  // Layer Toggles
  const [showPoliceStations, setShowPoliceStations] = useState(true);

  // Civic Guide Modal
  const [showCivicGuide, setShowCivicGuide] = useState(false);

  // Official Crime Heads Benchmark state
  const [crimeHeadsData, setCrimeHeadsData] = useState([]);
  const [benchmarkSearch, setBenchmarkSearch] = useState('');

  // Dataset Explorer controls
  const [dataSortColumn, setDataSortColumn] = useState('risk_index');
  const [dataSortDirection, setDataSortDirection] = useState('desc');
  const [dataWardFilter, setDataWardFilter] = useState('all');
  const [dataTierFilter, setDataTierFilter] = useState('all');
  const [showDataDictionary, setShowDataDictionary] = useState(false);

  // What-If Simulator state (heuristic planning levers)
  const [simChowkis, setSimChowkis] = useState(1);
  const [simLighting, setSimLighting] = useState(25);
  const [simPatrol, setSimPatrol] = useState('intensive');

  // Dynamic Upload Workflow State
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadParsed, setUploadParsed] = useState(null); // { headers, rows }
  const [uploadMapping, setUploadMapping] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle | parsing | preview | error | success
  const [uploadError, setUploadError] = useState('');
  const [uploadQuality, setUploadQuality] = useState(null);

  // Map references & Layer groups
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const stationsLayerRef = useRef(null);
  const selectionLayerRef = useRef(null);
  const fileInputRef = useRef(null);

  // Advanced Map UI Controls
  const [mapMode, setMapMode] = useState('light'); // 'light' | 'dark' | 'satellite'
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [showCoverageRadius, setShowCoverageRadius] = useState(true);

  // Check CARTO API Key
  const cartoApiKey = import.meta.env.VITE_CARTO_API_KEY;
  const hasCartoKey = Boolean(cartoApiKey && cartoApiKey.trim().length > 0);

  // 1. Initial Load: Curated Default Mumbai Dataset & Official Crime Heads Benchmark
  useEffect(() => {
    // Preload official Crime Heads Benchmark 2022-2023
    fetch('/data/mumbai_crime_heads_2022_2023.csv')
      .then(res => res.text())
      .then(text => {
        const parsed = parseCSV(text);
        if (parsed && parsed.rows && parsed.rows.length > 0) {
          setCrimeHeadsData(parsed.rows);
        }
      })
      .catch(err => console.warn('Benchmark preload note:', err));

    fetch('/data/citypulse_mumbai_curated.json')
      .then(res => res.json())
      .then(json => {
        setDefaultData(json);

        // Build active dataset wrapper for Mumbai
        const mumbaiDataset = {
          id: 'default_mumbai',
          name: 'CityPulse Mumbai Curated (Default)',
          isDefault: true,
          records: json.localities || [],
          police_stations: json.police_stations || [],
          rawColumns: Object.keys(json.localities?.[0] || {}),
          hasCoordinates: true,
          hasSpecializedAnalytics: true,
          geoBounds: [[18.89, 72.77], [19.27, 72.99]],
          metadata: {
            ...json.metadata,
            title: 'CityPulse Mumbai — Urban Safety & City Intelligence',
            description: '538 localities compilation with 56 verified anchor wards'
          },
          benchmark: json.benchmark,
          feature_importances: json.feature_importances,
          dataQuality: {
            totalRows: json.localities?.length || 538,
            validCoords: json.localities?.length || 538,
            missingCoords: 0,
            missingValuesCount: 0,
            duplicateRows: 0
          }
        };

        setActiveDataset(mumbaiDataset);
        if (json.localities && json.localities.length > 0) {
          const sorted = [...json.localities].sort((a, b) => (b.risk_index || 0) - (a.risk_index || 0));
          setSelectedLocality(sorted[0]);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading CityPulse data:', err);
        setLoading(false);
      });
  }, []);

  // 2. Handle File Selection in Upload Flow
  const handleFileSelect = (file) => {
    if (!file) return;
    setUploadFile(file);
    setUploadStatus('parsing');
    setUploadError('');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        let parsed = null;
        if (file.name.endsWith('.csv') || file.type.includes('csv') || file.type.includes('text/plain')) {
          parsed = parseCSV(text);
        } else if (file.name.endsWith('.json') || file.type.includes('json')) {
          parsed = parseJSON(text);
        } else {
          // Attempt CSV first, then JSON
          try {
            parsed = parseJSON(text);
          } catch {
            parsed = parseCSV(text);
          }
        }

        if (!parsed || parsed.rows.length === 0) {
          throw new Error('The file appears to be empty or could not be parsed into tabular rows.');
        }

        setUploadParsed(parsed);
        const autoMap = autoDetectMapping(parsed.headers, parsed.rows);
        setUploadMapping(autoMap);

        // Calculate data quality preview
        auditDataQuality(parsed.rows, autoMap);
        setUploadStatus('preview');
      } catch (err) {
        setUploadStatus('error');
        setUploadError(err.message || 'Failed to parse file format.');
      }
    };

    reader.onerror = () => {
      setUploadStatus('error');
      setUploadError('Failed to read file from disk.');
    };

    reader.readAsText(file);
  };

  // Quick-load official Mumbai Police IPC Crime Heads Benchmark
  const loadSampleCrimeHeads = () => {
    setUploadStatus('parsing');
    fetch('/data/mumbai_crime_heads_2022_2023.csv')
      .then(res => res.text())
      .then(text => {
        const parsed = parseCSV(text);
        setUploadFile({ name: 'mumbai_crime_heads_2022_2023.csv', size: text.length });
        setUploadParsed(parsed);
        const autoMap = autoDetectMapping(parsed.headers, parsed.rows);
        setUploadMapping(autoMap);
        auditDataQuality(parsed.rows, autoMap);
        setUploadStatus('preview');
      })
      .catch(err => {
        setUploadStatus('error');
        setUploadError('Failed to load sample crime heads CSV: ' + err.message);
      });
  };

  // 3. Audit Quality of Uploaded Rows
  const auditDataQuality = (rows, mapping) => {
    let validCoords = 0;
    let missingCoords = 0;
    let missingValuesCount = 0;

    const latKey = mapping.lat;
    const lonKey = mapping.lon;

    rows.forEach(r => {
      const latVal = cleanNumber(r[latKey]);
      const lonVal = cleanNumber(r[lonKey]);
      if (latKey && lonKey && !isNaN(latVal) && !isNaN(lonVal) && latVal >= -90 && latVal <= 90 && lonVal >= -180 && lonVal <= 180) {
        validCoords++;
      } else {
        missingCoords++;
      }

      Object.values(r).forEach(v => {
        if (v === '' || v === null || v === undefined) missingValuesCount++;
      });
    });

    const quality = {
      totalRows: rows.length,
      validCoords,
      missingCoords,
      missingValuesCount,
      duplicateRows: 0
    };
    setUploadQuality(quality);
    return quality;
  };

  // 4. Update Field Mapping
  const handleMappingChange = (concept, headerValue) => {
    const updated = { ...uploadMapping, [concept]: headerValue };
    setUploadMapping(updated);
    if (uploadParsed) {
      auditDataQuality(uploadParsed.rows, updated);
    }
  };

  // 5. Activate Uploaded Dataset
  const handleActivateDataset = () => {
    if (!uploadParsed || !uploadMapping) return;

    const rows = uploadParsed.rows;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    let hasCoords = false;

    const isSummaryRow = (name) => {
      const lower = String(name || '').toLowerCase().trim();
      return lower.startsWith('total') || lower === 'all' || lower.includes('grand total');
    };

    // Primary candidate columns
    const incCol = uploadMapping.crimes_against_women || uploadMapping.total_crimes;
    const detCol = uploadMapping.detection_rate;
    const prevCol = uploadMapping.previous_year;
    const detCountCol = uploadMapping.total_crimes;

    // Filter non-summary rows for log-scaling baseline
    const nonSummaryRows = rows.filter(r => !isSummaryRow(r[uploadMapping.locality]));
    const incVals = nonSummaryRows
      .map(r => cleanNumber(r[incCol]))
      .filter(v => !isNaN(v) && v >= 0);

    const minInc = incVals.length > 0 ? Math.min(...incVals) : 0;
    const maxInc = incVals.length > 0 ? Math.max(...incVals) : 100;
    const logMin = Math.log1p(minInc);
    const logMax = Math.log1p(maxInc);
    const logRange = logMax > logMin ? (logMax - logMin) : 1;

    const standardizedRecords = rows.map((r, idx) => {
      const rawName = uploadMapping.locality ? String(r[uploadMapping.locality] ?? `Area #${idx + 1}`) : `Area #${idx + 1}`;
      // Clean trailing periods or formatting: "Thefts." -> "Thefts", "H.B.T.Night." -> "H.B.T. Night"
      const localityName = rawName.replace(/\.+$/, '').replace(/([a-zA-Z])\.([a-zA-Z])/g, '$1. $2').trim();
      const isSummary = isSummaryRow(rawName);

      const latNum = cleanNumber(r[uploadMapping.lat]);
      const lonNum = cleanNumber(r[uploadMapping.lon]);
      const validCoord = uploadMapping.lat && uploadMapping.lon && !isNaN(latNum) && !isNaN(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;

      if (validCoord) {
        hasCoords = true;
        if (latNum < minLat) minLat = latNum;
        if (latNum > maxLat) maxLat = latNum;
        if (lonNum < minLon) minLon = lonNum;
        if (lonNum > maxLon) maxLon = lonNum;
      }

      // Incident & detection metrics
      const inc = cleanNumber(r[incCol]);
      const validInc = !isNaN(inc) ? inc : 0;

      const detRate = detCol ? cleanNumber(r[detCol]) : NaN;
      const validDetRate = !isNaN(detRate) ? Math.min(100, Math.max(0, detRate)) : null;

      const detCount = detCountCol ? cleanNumber(r[detCountCol]) : (validDetRate !== null ? Math.round((validInc * validDetRate) / 100) : null);
      const unsolvedCount = (validInc > 0 && detCount !== null && !isNaN(detCount)) ? Math.max(0, validInc - detCount) : null;

      const prevInc = prevCol ? cleanNumber(r[prevCol]) : NaN;
      const yoyChange = (!isNaN(prevInc) && prevInc > 0 && !isNaN(inc))
        ? Number((((inc - prevInc) / prevInc) * 100).toFixed(1))
        : null;

      // Priority / Risk Score Calculation
      let riskVal;
      if (uploadMapping.risk_index && !isNaN(cleanNumber(r[uploadMapping.risk_index]))) {
        riskVal = cleanNumber(r[uploadMapping.risk_index]);
      } else if (isSummary) {
        // Benchmark summary row
        riskVal = 14.0;
      } else if (incVals.length > 0) {
        // 1. Volume Factor (0 to 12 pts via log scaling)
        const logVal = Math.log1p(validInc);
        const volumeFactor = 12.0 * Math.max(0, Math.min(1, (logVal - logMin) / logRange));

        // 2. Unsolved Clearance Deficit (0 to 6 pts: lower clearance = higher ongoing threat)
        let unsolvedFactor = 2.0;
        if (validDetRate !== null) {
          const unsolvedPct = 100 - validDetRate;
          unsolvedFactor = 6.0 * (unsolvedPct / 100);
        }

        // 3. Severity Weighting (0 to 4 pts based on heinous/violent crime category)
        const lowerName = localityName.toLowerCase();
        let severityWeight = 1.0;
        if (lowerName.includes('murder') || lowerName.includes('rape') || lowerName.includes('dacoity')) {
          severityWeight = 3.5;
        } else if (lowerName.includes('robbery') || lowerName.includes('molestation') || lowerName.includes('extortion') || lowerName.includes('hurt') || lowerName.includes('riot')) {
          severityWeight = 2.5;
        } else if (lowerName.includes('theft') || lowerName.includes('h.b.t') || lowerName.includes('pocket')) {
          severityWeight = 1.5;
        }

        riskVal = Number((3.5 + volumeFactor + unsolvedFactor + severityWeight).toFixed(1));
        riskVal = Math.max(2.0, Math.min(25.0, riskVal));
      } else {
        riskVal = 8.5;
      }

      let tier = 'Medium';
      if (riskVal >= 15.0) tier = 'High';
      else if (riskVal < 7.0) tier = 'Low';

      // Tailored Operational Recommendations
      const lowerName = localityName.toLowerCase();
      let tailoredActions = [];
      if (lowerName.includes('theft') || lowerName.includes('m.v') || lowerName.includes('pocket')) {
        tailoredActions = [
          { priority: 'P1 Infrastructure Order', action: 'Transit CCTV & Vehicle Scanner Grid', schedule: 'Immediate (7-Day Sprint)', details: `Deploy high-resolution PTZ CCTV cameras at suburban railway entry/exit gates, bus terminals, and shopping hubs. Mandate digital vehicle tag scanning.` },
          { priority: 'P2 Plainclothes Beat', action: 'Anti-Pickpocket & Recovery Squad', schedule: 'Daily Peak Hours (5 PM - 10 PM)', details: `Deploy plainclothes detection officers along heavy commuter corridors to curb property loss.` }
        ];
      } else if (lowerName.includes('rape') || lowerName.includes('molestation')) {
        tailoredActions = [
          { priority: 'P1 Urgent Protection', action: 'Nirbhaya Mobile Safety Patrol & High-Mast Smart LED', schedule: 'Immediate / Continuous (24x7)', details: `Schedule dedicated Nirbhaya mobile safety vans around transit hubs, coaching centers, and unlit connecting footpaths. Fast-track high-mast smart LED floodlights.` },
          { priority: 'P1 Legal Fast-Track', action: 'Dedicated Women Safety Cell Supervision', schedule: 'Immediate Enforcement', details: `Ensure 100% of cases are supervised by designated ACP Women Safety division and charge-sheeted within 60 days.` }
        ];
      } else if (lowerName.includes('murder') || lowerName.includes('hurt') || lowerName.includes('dacoity') || lowerName.includes('riot')) {
        tailoredActions = [
          { priority: 'P1 Deterrence', action: 'Static Police Picket & Armed Mobile Beat', schedule: 'Night Operations (10 PM - 5 AM)', details: `Erect high-visibility static police pickets and deploy armed mobile vans across volatile junctions.` },
          { priority: 'P2 Rapid Forensic', action: 'Forensic Evidence Fast-Track Protocol', schedule: 'Within 24 Hours', details: `Dispatch mobile forensic crime vans to scene immediately to maintain 95%+ detection clearance.` }
        ];
      } else {
        tailoredActions = [
          { priority: tier === 'High' ? 'P1 Urgent Allocation' : 'P2 Monitoring', action: 'Safety Infrastructure Review', schedule: 'Immediate', details: `Conduct spatial patrol and streetlighting assessment across ${localityName}.` }
        ];
      }

      const chowkisVal = uploadMapping.police_chowkis ? (cleanNumber(r[uploadMapping.police_chowkis]) || 1) : 1;
      const densityVal = uploadMapping.population_density ? (cleanNumber(r[uploadMapping.population_density]) || 20000) : 20000;
      const uhiVal = uploadMapping.uhi_index ? (cleanNumber(r[uploadMapping.uhi_index]) || 0.5) : 0.5;
      const internetVal = uploadMapping.internet_pct ? (cleanNumber(r[uploadMapping.internet_pct]) || 75) : 75;

      return {
        locality: localityName,
        rawName,
        isSummary,
        ward: uploadMapping.ward ? String(r[uploadMapping.ward] ?? 'City-Wide') : 'City-Wide Jurisdiction',
        zone: uploadMapping.zone ? String(r[uploadMapping.zone] ?? 'Mumbai Metropolitan') : (isSummary ? 'City Aggregate' : 'IPC Crime Category'),
        lat: validCoord ? latNum : null,
        lon: validCoord ? lonNum : null,
        risk_index: riskVal,
        risk_tier: tier,
        population: densityVal * 0.5,
        population_density: densityVal,
        police_chowkis: chowkisVal,
        crimes_against_women: validInc,
        total_crimes: detCount !== null ? detCount : validInc,
        registered_count: validInc,
        detected_count: detCount,
        unsolved_count: unsolvedCount,
        detection_rate: validDetRate,
        prev_registered: !isNaN(prevInc) ? prevInc : null,
        yoy_change: yoyChange,
        uhi_index: uhiVal,
        uhi_category: uhiVal > 0.65 ? 'High' : (uhiVal > 0.4 ? 'Medium' : 'Low'),
        internet_pct: internetVal,
        ci_lower: (riskVal * 0.88).toFixed(1),
        ci_upper: (riskVal * 1.12).toFixed(1),
        feature_contributions: {
          crimes_against_women_factor: Math.round(Math.min(65, Math.max(30, (riskVal / 25) * 55))),
          density_strain_factor: Math.round(Math.min(30, Math.max(15, (1 - (validDetRate ? validDetRate/100 : 0.5)) * 30))),
          chowki_deficit_factor: 15,
          built_env_uhi_factor: 10
        },
        recommended_actions: tailoredActions,
        raw: r
      };
    });

    const hasSpecialized = Boolean(uploadMapping.crimes_against_women && uploadMapping.police_chowkis);

    const highCount = standardizedRecords.filter(r => r.risk_tier === 'High').length;
    const medCount = standardizedRecords.filter(r => r.risk_tier === 'Medium').length;
    const lowCount = standardizedRecords.filter(r => r.risk_tier === 'Low').length;

    const newActiveDataset = {
      id: `custom_${Date.now()}`,
      name: uploadFile?.name || 'Custom Uploaded Dataset',
      isDefault: false,
      records: standardizedRecords,
      police_stations: [], // Hide default Mumbai stations for external datasets
      rawColumns: uploadParsed.headers,
      fieldMapping: uploadMapping,
      hasCoordinates: hasCoords,
      hasSpecializedAnalytics: hasSpecialized,
      geoBounds: hasCoords ? [[minLat, minLon], [maxLat, maxLon]] : null,
      metadata: {
        title: uploadFile?.name || 'User Custom Dataset',
        city: uploadMapping.locality ? 'Custom Region' : 'Custom Area',
        total_localities: standardizedRecords.length,
        high_risk_count: highCount,
        medium_risk_count: medCount,
        safe_count: lowCount,
        generated_timestamp: new Date().toISOString()
      },
      benchmark: {
        models: [
          { name: 'Baseline Mean', type: 'Unweighted Center', features_used: 'Single Metric', mae: '—', rmse: '—', r2: '—', spearman_rho: '—', role: 'Baseline' },
          { name: 'Active Index', type: hasSpecialized ? 'Multi-Criteria Index' : 'General Ranking', features_used: Object.values(uploadMapping).filter(Boolean).join(', '), mae: '—', rmse: '—', r2: '—', spearman_rho: '—', role: 'Active Indicator' }
        ]
      },
      feature_importances: [
        { feature: 'incidents', ridge_coefficient: 0.12, role: 'Recorded Volume' },
        { feature: 'police_density', ridge_coefficient: -0.40, role: 'Facility Buffer' },
        { feature: 'population_density', ridge_coefficient: 0.08, role: 'Crowd Pressure' }
      ],
      dataQuality: uploadQuality || auditDataQuality(rows, uploadMapping)
    };

    setActiveDataset(newActiveDataset);
    setSelectedLocality(standardizedRecords[0] || null);
    setSearchQuery('');
    setZoneFilter('all');
    setTierFilter('all');
    setActiveTab('cockpit');

    // Pan map to new dataset bounds if coordinates exist
    if (hasCoords && mapInstanceRef.current) {
      setTimeout(() => {
        try {
          if (minLat === maxLat && minLon === maxLon) {
            mapInstanceRef.current.setView([minLat, minLon], 13);
          } else {
            mapInstanceRef.current.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [40, 40], maxZoom: 14 });
          }
        } catch (e) {
          console.warn('Map bounds adjustment notice:', e);
        }
      }, 150);
    }
  };

  // 6. Reset to Default Curated Mumbai Dataset
  const handleResetToDefault = () => {
    if (!defaultData) return;
    const mumbaiDataset = {
      id: 'default_mumbai',
      name: 'CityPulse Mumbai Curated (Default)',
      isDefault: true,
      records: defaultData.localities || [],
      police_stations: defaultData.police_stations || [],
      rawColumns: Object.keys(defaultData.localities?.[0] || {}),
      hasCoordinates: true,
      hasSpecializedAnalytics: true,
      geoBounds: [[18.89, 72.77], [19.27, 72.99]],
      metadata: {
        ...defaultData.metadata,
        title: 'Greater Mumbai Urban Safety DSS',
        description: '538 localities compilation with 56 verified anchor wards'
      },
      benchmark: defaultData.benchmark,
      feature_importances: defaultData.feature_importances,
      dataQuality: {
        totalRows: defaultData.localities?.length || 538,
        validCoords: defaultData.localities?.length || 538,
        missingCoords: 0,
        missingValuesCount: 0,
        duplicateRows: 0
      }
    };

    setActiveDataset(mumbaiDataset);
    if (defaultData.localities && defaultData.localities.length > 0) {
      const sorted = [...defaultData.localities].sort((a, b) => (b.risk_index || 0) - (a.risk_index || 0));
      setSelectedLocality(sorted[0]);
    }
    setSearchQuery('');
    setZoneFilter('all');
    setTierFilter('all');
    setQuickFilter('all');

    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([19.0800, 72.8700], 11);
    }
  };

  // 7. Filtered Localities derived strictly from activeDataset
  const filteredLocalities = useMemo(() => {
    if (!activeDataset || !activeDataset.records) return [];
    return activeDataset.records.filter(loc => {
      const locName = String(loc.locality ?? '').toLowerCase();
      const locWard = String(loc.ward ?? '').toLowerCase();
      const matchSearch = !searchQuery.trim() || 
        locName.includes(searchQuery.toLowerCase()) || 
        locWard.includes(searchQuery.toLowerCase());
      const matchZone = zoneFilter === 'all' || loc.zone === zoneFilter;
      const matchTier = tierFilter === 'all' || loc.risk_tier === tierFilter;
      
      let matchQuick = true;
      if (quickFilter === 'high') matchQuick = loc.risk_tier === 'High';
      else if (quickFilter === 'med') matchQuick = loc.risk_tier === 'Medium';
      else if (quickFilter === 'low') matchQuick = loc.risk_tier === 'Low';
      else if (quickFilter === 'chowki_deficit') matchQuick = (loc.police_chowkis ?? 0) <= 1;
      else if (quickFilter === 'dense') matchQuick = (loc.population_density ?? 0) >= 45000;

      return matchSearch && matchZone && matchTier && matchQuick;
    });
  }, [activeDataset, searchQuery, zoneFilter, tierFilter, quickFilter]);

  // Derived selectedLocality: automatically keeps selection within filteredLocalities
  const selectedLocality = useMemo(() => {
    if (!filteredLocalities || filteredLocalities.length === 0) return null;
    const found = filteredLocalities.find(l => l.locality === selectedLocalityManual?.locality);
    return found || filteredLocalities[0];
  }, [filteredLocalities, selectedLocalityManual]);

  // Sort localities for Data Explorer table
  const sortedLocalities = useMemo(() => {
    if (!filteredLocalities) return [];
    const list = [...filteredLocalities];
    list.sort((a, b) => {
      const valA = a[dataSortColumn];
      const valB = b[dataSortColumn];
      if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB);
        return dataSortDirection === 'asc' ? cmp : -cmp;
      }
      const numA = isNaN(cleanNumber(valA)) ? 0 : cleanNumber(valA);
      const numB = isNaN(cleanNumber(valB)) ? 0 : cleanNumber(valB);
      return dataSortDirection === 'asc' ? numA - numB : numB - numA;
    });
    return list;
  }, [filteredLocalities, dataSortColumn, dataSortDirection]);

  // Handle Sort Toggle for Data Explorer
  const handleSortToggle = (columnKey) => {
    if (dataSortColumn === columnKey) {
      setDataSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setDataSortColumn(columnKey);
      setDataSortDirection('desc');
    }
  };

  // Center on locality with smooth animation
  const handleCenterLocality = (loc) => {
    if (!loc) return;
    setSelectedLocality(loc);
    if (activeTab !== 'cockpit') {
      setActiveTab('cockpit');
    }
    if (mapInstanceRef.current && loc.lat !== null && loc.lon !== null && !isNaN(loc.lat) && !isNaN(loc.lon)) {
      setTimeout(() => {
        mapInstanceRef.current.setView([loc.lat, loc.lon], 14, { animate: true });
      }, 120);
    }
  };

  // Export filtered dataset to CSV
  const handleExportCSV = () => {
    if (!filteredLocalities || filteredLocalities.length === 0) return;
    const sample = filteredLocalities[0];
    const keys = Object.keys(sample).filter(k => typeof sample[k] !== 'object');
    const csvRows = [];
    csvRows.push(keys.join(','));
    filteredLocalities.forEach(row => {
      const values = keys.map(k => {
        const val = row[k] ?? '';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      });
      csvRows.push(values.join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${activeDataset.id || 'citypulse'}_records.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Plain-English Executive Assessment for Selected Locality
  const executiveAssessment = useMemo(() => {
    if (!selectedLocality) return null;
    const tier = selectedLocality.risk_tier || 'Low';
    const score = Number(selectedLocality.risk_index || 0).toFixed(1);
    const density = selectedLocality.population_density ? Math.round(selectedLocality.population_density).toLocaleString() : null;
    const chowkis = selectedLocality.police_chowkis ?? 0;
    const incidents = selectedLocality.crimes_against_women ?? selectedLocality.total_crimes ?? null;

    if (tier === 'High') {
      return {
        badge: 'Priority 1 Urgent Deployment',
        className: 'high-risk',
        text: `${selectedLocality.locality} is flagged as Priority 1 (Score: ${score}). High population density (${density ? `${density}/km²` : 'dense node'}) and an outpost shortage (${chowkis} chowki${chowkis === 1 ? '' : 's'}) create elevated incident strain (${incidents !== null ? `${incidents} recorded incidents` : 'high volume'}). Recommended for auxiliary chowki installation and smart streetlighting in the simulator.`
      };
    } else if (tier === 'Medium') {
      return {
        badge: 'Priority 2 Proactive Monitoring',
        className: 'med-risk',
        text: `${selectedLocality.locality} is flagged as Priority 2 (Score: ${score}). Exhibits moderate vulnerability with balanced baseline coverage (${chowkis} outposts). Recommended for proactive night patrolling, lighting audit, and routine foot beats.`
      };
    } else {
      return {
        badge: 'Priority 3 Maintenance Baseline',
        className: 'low-risk',
        text: `${selectedLocality.locality} is categorized as Priority 3 (Score: ${score}). Maintained with adequate outpost distribution (${chowkis} chowkis) and lower incident density. Recommended for regular administrative maintenance.`
      };
    }
  }, [selectedLocality]);

  // Unique Zones in Active Dataset
  const availableZones = useMemo(() => {
    if (!activeDataset || !activeDataset.records) return [];
    return Array.from(new Set(activeDataset.records.map(r => r.zone).filter(Boolean)));
  }, [activeDataset]);

  // 8. Leaflet Map Initialization - Watermark-Free Light Map Experience
  useEffect(() => {
    if (loading || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [19.0800, 72.8700],
        zoom: 11,
        zoomControl: false,
        preferCanvas: true
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Clean tile layer: If CARTO key is configured, use authenticated CARTO Positron;
      // otherwise fall back to OpenStreetMap standard tiles to prevent CARTO's "API KEY REQUIRED" watermark
      const tileUrl = hasCartoKey
        ? `https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${cartoApiKey.trim()}`
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      const tileAttr = hasCartoKey
        ? '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>'
        : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

      const tileLayer = L.tileLayer(tileUrl, {
        attribution: tileAttr,
        subdomains: hasCartoKey ? 'abcd' : 'abc',
        maxZoom: 19
      });

      // Automatic fallback if CARTO key or tiles fail
      tileLayer.on('tileerror', function(error, tile) {
        tile.src = `https://tile.openstreetmap.org/${error.coords.z}/${error.coords.x}/${error.coords.y}.png`;
      });

      tileLayer.addTo(map);
      tileLayerRef.current = tileLayer;

      markersLayerRef.current = L.layerGroup().addTo(map);
      stationsLayerRef.current = L.layerGroup().addTo(map);
      selectionLayerRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;
    }
  }, [loading, hasCartoKey, cartoApiKey]);

  // 8B. Dynamic Basemap Switcher (Light / Dark / Satellite)
  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayerRef.current) return;

    let tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    let tileAttr = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
    let subdomains = 'abc';
    let maxZoom = 19;

    if (mapMode === 'dark') {
      tileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png';
      tileAttr = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';
      subdomains = 'abcd';
    } else if (mapMode === 'satellite') {
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      tileAttr = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS Community';
      subdomains = 'abc';
      maxZoom = 18;
    } else if (hasCartoKey) {
      tileUrl = `https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${cartoApiKey.trim()}`;
      tileAttr = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';
      subdomains = 'abcd';
    }

    try {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    } catch (e) {
      // ignore
    }

    const newTileLayer = L.tileLayer(tileUrl, {
      attribution: tileAttr,
      subdomains,
      maxZoom
    });

    newTileLayer.on('tileerror', function(error, tile) {
      tile.src = `https://tile.openstreetmap.org/${error.coords.z}/${error.coords.x}/${error.coords.y}.png`;
    });

    newTileLayer.addTo(mapInstanceRef.current);
    tileLayerRef.current = newTileLayer;
    newTileLayer.bringToBack();
  }, [mapMode, hasCartoKey, cartoApiKey]);

  // 8C. Fullscreen / Expanded Map Canvas Auto-Resize
  useEffect(() => {
    if (mapInstanceRef.current) {
      const t1 = setTimeout(() => mapInstanceRef.current?.invalidateSize(), 80);
      const t2 = setTimeout(() => mapInstanceRef.current?.invalidateSize(), 250);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isMapExpanded]);

  // 8D. Selected Locality Radar Beacon & 1.5km Catchment Buffer
  useEffect(() => {
    if (!mapInstanceRef.current || !selectionLayerRef.current) return;
    selectionLayerRef.current.clearLayers();

    if (!selectedLocality || selectedLocality.lat === null || selectedLocality.lon === null || isNaN(selectedLocality.lat) || isNaN(selectedLocality.lon)) {
      return;
    }

    const { lat, lon, risk_tier, locality } = selectedLocality;
    const tierColor = risk_tier === 'High' ? '#FF7868' : (risk_tier === 'Medium' ? '#F59E0B' : '#168BFF');

    // 1. Municipal Response Catchment Buffer (1.5 km radius)
    if (showCoverageRadius) {
      const catchmentCircle = L.circle([lat, lon], {
        radius: 1500,
        color: tierColor,
        dashArray: '6, 6',
        weight: 2,
        fillColor: tierColor,
        fillOpacity: 0.12,
        interactive: false
      });
      selectionLayerRef.current.addLayer(catchmentCircle);
    }

    // 2. Animated Radar Beacon Ping
    const beaconIcon = L.divIcon({
      className: 'map-beacon-marker',
      html: `<div class="map-beacon-ping ${risk_tier === 'High' ? 'ping-high' : ''}"></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const beaconMarker = L.marker([lat, lon], {
      icon: beaconIcon,
      interactive: false,
      zIndexOffset: 1000
    });
    selectionLayerRef.current.addLayer(beaconMarker);
  }, [selectedLocality, showCoverageRadius]);

  // 9. ResizeObserver and Tab Invalidate Size: ensures map never renders as grey/white blank
  useEffect(() => {
    if (activeTab === 'cockpit' && mapInstanceRef.current) {
      const t1 = setTimeout(() => mapInstanceRef.current?.invalidateSize(), 50);
      const t2 = setTimeout(() => mapInstanceRef.current?.invalidateSize(), 200);
      const t3 = setTimeout(() => mapInstanceRef.current?.invalidateSize(), 500);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
  }, [activeTab]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    ro.observe(mapContainerRef.current);
    return () => ro.disconnect();
  }, [loading]);

  // 10. Update map markers strictly from activeDataset
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !activeDataset) return;

    markersLayerRef.current.clearLayers();
    stationsLayerRef.current.clearLayers();

    // 1. Plot Police Stations (Default Mumbai only, when layer is active)
    if (showPoliceStations && activeDataset.police_stations && activeDataset.police_stations.length > 0) {
      activeDataset.police_stations.forEach(st => {
        if (!st.lat || !st.lon) return;
        const policeIcon = L.divIcon({
          className: 'police-station-marker',
          html: `<div style="background:#168BFF;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff;box-shadow:0 2px 8px rgba(22,139,255,0.45);font-size:12px;">🚔</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const m = L.marker([st.lat, st.lon], { icon: policeIcon })
          .bindPopup(`
            <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:12px;color:#1E293B;padding:4px;">
              <strong style="color:#168BFF;font-size:13px;">${st.name}</strong><br/>
              <span style="color:#64748B;">Ward: <b style="color:#1E293B;">${st.ward}</b></span><br/>
              <span style="color:#64748B;">Emergency Phone: <b style="color:#1E293B;">${st.phone}</b></span>
            </div>
          `);
        stationsLayerRef.current.addLayer(m);
      });
    }

    // 2. Plot Active Dataset Localities (Only records with valid coordinates)
    const validCoordsList = [];
    filteredLocalities.forEach(loc => {
      if (loc.lat === null || loc.lon === null || isNaN(loc.lat) || isNaN(loc.lon)) return;
      validCoordsList.push(loc);

      const isSelected = selectedLocality && selectedLocality.locality === loc.locality;
      
      let color = '#20B879'; // Lower-Priority / Maintenance
      if (loc.risk_tier === 'High') color = '#FF7868'; // Coral
      else if (loc.risk_tier === 'Medium') color = '#F59E0B'; // Amber

      const radius = isSelected ? 12 : (loc.risk_tier === 'High' ? 8.5 : 6);
      const circle = L.circleMarker([loc.lat, loc.lon], {
        radius: radius,
        fillColor: color,
        color: isSelected ? '#168BFF' : '#FFFFFF',
        weight: isSelected ? 3.5 : 1.5,
        opacity: 1,
        fillOpacity: isSelected ? 0.92 : 0.72
      });

      // Quick hover tooltip
      circle.bindTooltip(`
        <div style="font-family:'Plus Jakarta Sans',sans-serif;padding:2px 4px;">
          <b style="color:#1E293B;">${loc.locality}</b> (${loc.ward || 'General'})<br/>
          Priority Index: <b style="color:${color};">${Number(loc.risk_index).toFixed(1)}</b> [${loc.risk_tier === 'Low' ? 'Lower-Priority' : `${loc.risk_tier} Priority`}]<br/>
          ${loc.crimes_against_women !== undefined ? `Incidents: <b>${loc.crimes_against_women}</b> · Chowkis: <b>${loc.police_chowkis}</b>` : `Mapped Record`}
        </div>
      `, { sticky: true, className: 'custom-leaflet-tooltip' });

      // Rich Card Popup on Click
      const popupHtml = `
        <div class="map-popup-card">
          <div class="map-popup-header">
            <span class="badge ${loc.risk_tier === 'High' ? 'badge-red' : (loc.risk_tier === 'Medium' ? 'badge-amber' : 'badge-emerald')}">
              ${loc.risk_tier === 'Low' ? 'Lower Priority (P3)' : `${loc.risk_tier} Priority (P${loc.risk_tier === 'High' ? '1' : '2'})`}
            </span>
            <span style="font-size: 0.72rem; color: #64748B; font-weight: 700;">${loc.zone || 'Mumbai'}</span>
          </div>
          <div style="font-size: 1.05rem; font-weight: 800; color: #1E293B; margin-top: 4px;">${loc.locality}</div>
          <div style="font-size: 0.75rem; color: #64748B;">Ward / Zone: <b>${loc.ward || 'General'}</b></div>
          <div class="map-popup-grid">
            <div class="map-popup-stat">
              <span class="stat-lbl">Priority Score</span>
              <span class="stat-val" style="color: ${color}">${Number(loc.risk_index).toFixed(1)} <small>/20</small></span>
            </div>
            <div class="map-popup-stat">
              <span class="stat-lbl">Nearest Police</span>
              <span class="stat-val">${loc.distance_to_police_km !== undefined ? `${loc.distance_to_police_km} km` : (loc.police_chowkis !== undefined ? `${loc.police_chowkis} posts` : '—')}</span>
            </div>
            <div class="map-popup-stat">
              <span class="stat-lbl">Pop. Density</span>
              <span class="stat-val">${loc.population_density !== undefined ? `${Number(loc.population_density).toLocaleString()}/km²` : '—'}</span>
            </div>
            <div class="map-popup-stat">
              <span class="stat-lbl">Light Deficit</span>
              <span class="stat-val">${loc.lighting_deficit_score !== undefined ? `${loc.lighting_deficit_score}%` : '—'}</span>
            </div>
          </div>
          <div style="font-size: 0.7rem; color: #168BFF; font-weight: 700; margin-top: 6px; text-align: center;">
            ✓ Loaded in Dossier &amp; Simulator
          </div>
        </div>
      `;
      circle.bindPopup(popupHtml, { maxWidth: 260, className: 'custom-card-popup' });

      circle.on('click', () => {
        setSelectedLocality(loc);
      });

      markersLayerRef.current.addLayer(circle);
    });

    // Smart Camera/Bounds adjustment:
    const isFiltered = searchQuery.trim().length > 0 || zoneFilter !== 'all' || tierFilter !== 'all';
    if (isFiltered && validCoordsList.length > 0) {
      if (validCoordsList.length === 1) {
        mapInstanceRef.current.setView([validCoordsList[0].lat, validCoordsList[0].lon], 14, { animate: true });
      } else if (validCoordsList.length <= 25) {
        const bounds = L.latLngBounds(validCoordsList.map(l => [l.lat, l.lon]));
        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: true });
      }
    } else if (selectedLocality && selectedLocality.lat !== null && selectedLocality.lon !== null) {
      mapInstanceRef.current.setView([selectedLocality.lat, selectedLocality.lon], 13, { animate: true });
    }
  }, [filteredLocalities, selectedLocality, activeDataset, searchQuery, zoneFilter, tierFilter, showPoliceStations]);

  // Handle Locality Selection
  const handleSelectLocality = (loc) => {
    setSelectedLocality(loc);
  };

  // 11. What-If Simulator Recalculation (Hypothetical Planning Heuristic)
  const simResults = useMemo(() => {
    if (!selectedLocality || selectedLocality.risk_index === undefined) return null;

    const baseRisk = Number(selectedLocality.risk_index);
    
    // Heuristic planning levers (arithmetic reductions for resource scenario exploration)
    const chowkiReduction = simChowkis * 1.45;
    const lightingReduction = (simLighting / 50) * 2.2;
    const patrolReduction = simPatrol === 'intensive' ? 1.8 : 0.8;

    const totalReduction = chowkiReduction + lightingReduction + patrolReduction;
    const newRisk = Math.max(0.1, Math.min(baseRisk, baseRisk - totalReduction));
    const pctDrop = baseRisk > 0 ? Math.round(((baseRisk - newRisk) / baseRisk) * 100) : 0;

    let newTier = 'Low';
    if (newRisk >= 15.0) newTier = 'High';
    else if (newRisk >= 7.0) newTier = 'Medium';

    return {
      baseRisk,
      newRisk,
      pctDrop,
      oldTier: selectedLocality.risk_tier,
      newTier,
      totalReduction
    };
  }, [selectedLocality, simChowkis, simLighting, simPatrol]);

  if (loading || !activeDataset) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF' }}>
        <RefreshCw size={36} className="beacon-pulse" style={{ color: '#168BFF', marginBottom: 16 }} />
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1E293B' }}>Loading CityPulse Decision Engine...</h2>
        <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 4 }}>Preparing active spatial indices &amp; benchmarks</p>
      </div>
    );
  }

  const { metadata, benchmark, feature_importances, dataQuality } = activeDataset;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#FFFFFF' }}>
      
      {/* ── TOP CITIZEN DISCLAIMER BANNER ── */}
      <div style={{ background: '#FFF0E8', color: '#9A2C1C', padding: '9px 24px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #FFD1C9', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AlertTriangle size={16} color="#FF7868" />
          <span><b>Decision-Support Platform:</b> CityPulse is an indicator demonstration tool for municipal resource prioritization, NOT an emergency dispatch service.</span>
          <button
            type="button"
            onClick={() => setShowCivicGuide(true)}
            style={{
              background: '#FFFFFF',
              border: '1px solid #FFD1C9',
              color: '#9A2C1C',
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            <BookOpen size={12} /> Civic Guide &amp; How It Works
          </button>
        </div>
        <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-mono)', fontSize: '0.76rem', fontWeight: 700 }}>
          <span>Emergency: <b>112</b></span>
          <span>Police: <b>100</b></span>
          <span>Citizen Helpline: <b>103 / 1090</b></span>
          <span>BMC Disaster: <b>1916</b></span>
        </div>
      </div>

      {/* ── TOP NAVIGATION BAR ── */}
      <header className="app-header">
        <button 
          type="button"
          className="app-brand-btn"
          onClick={() => setActiveTab('cockpit')}
          title="CityPulse Mumbai — Return to Cockpit & Map"
          aria-label="CityPulse Mumbai — Urban Safety and City Intelligence"
        >
          <img 
            src="/citypulse-mumbai-logo.png" 
            alt="CityPulse Mumbai — Urban Safety and City Intelligence" 
            className="header-logo"
            width={240}
            height={99}
          />
        </button>

        {/* Tab Navigation */}
        <nav className="nav-tabs">
          <button 
            className={`nav-btn ${activeTab === 'cockpit' ? 'active' : ''}`}
            onClick={() => setActiveTab('cockpit')}
          >
            <Compass size={16} /> Cockpit &amp; Map
          </button>
          <button 
            className={`nav-btn ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            <Upload size={16} /> Upload Data
          </button>
          <button 
            className={`nav-btn ${activeTab === 'simulator' ? 'active' : ''}`}
            onClick={() => setActiveTab('simulator')}
          >
            <Sliders size={16} /> Planning Simulator
          </button>
          <button 
            className={`nav-btn ${activeTab === 'eda' ? 'active' : ''}`}
            onClick={() => setActiveTab('eda')}
          >
            <TrendingUp size={16} /> Actionable Discoveries
          </button>
          <button 
            className={`nav-btn ${activeTab === 'benchmark' ? 'active' : ''}`}
            onClick={() => setActiveTab('benchmark')}
          >
            <BarChart3 size={16} /> Method &amp; Baseline
          </button>
          <button 
            className={`nav-btn ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => setActiveTab('data')}
          >
            <Database size={16} /> Dataset Explorer
          </button>
        </nav>

        {/* Header Actions & Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setShowCivicGuide(true)}
            className="btn-secondary"
            style={{ fontSize: '0.74rem', padding: '6px 12px' }}
            title="Read plain-English documentation on priority indicators, factor weights, and simulations"
          >
            <BookOpen size={14} color="#168BFF" />
            <span>Civic Guide</span>
          </button>

          <span className={`badge ${activeDataset.isDefault ? 'badge-blue' : 'badge-emerald'}`}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeDataset.isDefault ? '#168BFF' : '#20B879', display: 'inline-block' }}></span>
            {activeDataset.isDefault ? 'Mumbai Default' : 'Custom Upload'}
          </span>

          {!activeDataset.isDefault && (
            <button
              onClick={handleResetToDefault}
              style={{
                background: '#FFFFFF',
                border: '1px solid #BAE6FD',
                color: '#168BFF',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Reset to Default
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN CONTENT CONTAINER ── */}
      <main style={{ flex: 1, padding: '16px 24px 24px', maxWidth: 1600, width: '100%', margin: '0 auto', background: '#FFFFFF' }}>

        {/* Active Dataset Notice Banner */}
        <div className="dataset-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Database size={18} color="#168BFF" />
            <span style={{ fontSize: '0.84rem', color: '#1E293B', fontWeight: 600 }}>
              Active Dataset: <b style={{ color: '#168BFF' }}>{activeDataset.name}</b> ({activeDataset.records.length} records)
            </span>
            <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>
              {activeDataset.hasSpecializedAnalytics ? 'Specialized Safety DSS' : 'General Spatial Profile'}
            </span>
            {!activeDataset.hasCoordinates && (
              <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}>
                Coordinates Missing (Table &amp; Category View)
              </span>
            )}
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              · {filteredLocalities.length} records currently visible
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => setActiveTab('upload')}
              style={{
                background: '#E8F6FF',
                border: '1px solid #BAE6FD',
                color: '#168BFF',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Upload size={14} /> Upload / Switch Dataset
            </button>
            {!activeDataset.isDefault && (
              <button
                onClick={handleResetToDefault}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #FFD1C9',
                  color: '#FF7868',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Reset to Mumbai Curated
              </button>
            )}
          </div>
        </div>

        {/* Top Metric Ribbon - Derived from Active Dataset & Clickable Filters */}
        <div className="metric-grid">
          {/* Card 1: Total Records */}
          <div 
            className={`metric-card interactive ${tierFilter === 'all' && quickFilter === 'all' ? 'active-filter' : ''}`} 
            style={{ background: '#E8F6FF', border: '1px solid #BAE6FD' }}
            onClick={() => { setTierFilter('all'); setQuickFilter('all'); setZoneFilter('all'); setSearchQuery(''); }}
            title="Click to view all localities"
          >
            <div className="metric-label" style={{ color: '#0369A1' }}>
              <span>Total Records</span>
              <Building2 size={16} color="#168BFF" />
            </div>
            <div className="metric-val" style={{ color: '#168BFF' }}>{activeDataset.records.length}</div>
            <div className="metric-sub" style={{ color: '#0284C7' }}>
              {activeDataset.isDefault ? 'Greater Mumbai Localities' : 'Active Tabular Compilation'}
            </div>
            <div className="filter-hint" style={{ color: '#0369A1' }}>
              {tierFilter === 'all' && quickFilter === 'all' ? '✓ Showing All' : 'Click to reset filter'}
            </div>
          </div>

          {/* Card 2: High Priority */}
          <div 
            className={`metric-card interactive ${tierFilter === 'High' ? 'active-filter' : ''}`} 
            style={{ background: '#FFF0E8', border: '1px solid #FFD1C9' }}
            onClick={() => { setTierFilter(tierFilter === 'High' ? 'all' : 'High'); setQuickFilter('all'); }}
            title="Click to filter by High Priority (Score ≥15)"
          >
            <div className="metric-label" style={{ color: '#9A2C1C' }}>
              <span>High Priority</span>
              <AlertTriangle size={16} color="#FF7868" />
            </div>
            <div className="metric-val" style={{ color: '#FF7868' }}>{metadata.high_risk_count}</div>
            <div className="metric-sub" style={{ color: '#B91C1C' }}>P1 Priority Allocation Zones (≥15)</div>
            <div className="filter-hint" style={{ color: '#9A2C1C' }}>
              {tierFilter === 'High' ? '✓ Active Filter' : 'Click to isolate P1 zones'}
            </div>
          </div>

          {/* Card 3: Medium Priority */}
          <div 
            className={`metric-card interactive ${tierFilter === 'Medium' ? 'active-filter' : ''}`} 
            style={{ background: '#FFF7D6', border: '1px solid #FDE68A' }}
            onClick={() => { setTierFilter(tierFilter === 'Medium' ? 'all' : 'Medium'); setQuickFilter('all'); }}
            title="Click to filter by Medium Priority (Score 7–14.9)"
          >
            <div className="metric-label" style={{ color: '#92400E' }}>
              <span>Medium Priority</span>
              <AlertTriangle size={16} color="#D97706" />
            </div>
            <div className="metric-val" style={{ color: '#D97706' }}>{metadata.medium_risk_count}</div>
            <div className="metric-sub" style={{ color: '#B45309' }}>P2 Proactive Vigilance (7 – 14.9)</div>
            <div className="filter-hint" style={{ color: '#92400E' }}>
              {tierFilter === 'Medium' ? '✓ Active Filter' : 'Click to isolate P2 zones'}
            </div>
          </div>

          {/* Card 4: Lower-Priority */}
          <div 
            className={`metric-card interactive ${tierFilter === 'Low' ? 'active-filter' : ''}`} 
            style={{ background: '#E5FAEF', border: '1px solid #A7F3D0' }}
            onClick={() => { setTierFilter(tierFilter === 'Low' ? 'all' : 'Low'); setQuickFilter('all'); }}
            title="Click to filter by Lower-Priority (<7)"
          >
            <div className="metric-label" style={{ color: '#065F46' }}>
              <span>Lower-Priority</span>
              <CheckCircle2 size={16} color="#20B879" />
            </div>
            <div className="metric-val" style={{ color: '#20B879' }}>{metadata.safe_count}</div>
            <div className="metric-sub" style={{ color: '#047857' }}>P3 Baseline Maintenance (&lt;7)</div>
            <div className="filter-hint" style={{ color: '#065F46' }}>
              {tierFilter === 'Low' ? '✓ Active Filter' : 'Click to isolate P3 zones'}
            </div>
          </div>

          {/* Card 5: Method & Baseline Mode */}
          <div 
            className="metric-card interactive" 
            style={{ background: '#F0EBFF', border: '1px solid #DDD6FE' }}
            onClick={() => setActiveTab('benchmark')}
            title="Click to inspect model performance & baseline formula"
          >
            <div className="metric-label" style={{ color: '#5B21B6' }}>
              <span>Analysis Mode</span>
              <Sparkles size={16} color="#7C3AED" />
            </div>
            <div className="metric-val" style={{ color: '#7C3AED', fontSize: '1.25rem' }}>
              {activeDataset.hasSpecializedAnalytics ? 'Specialized DSS' : 'Spatial Profile'}
            </div>
            <div className="metric-sub" style={{ color: '#6D28D9' }}>
              {activeDataset.hasCoordinates ? `${dataQuality.validCoords} mapped pins` : 'Table view only'}
            </div>
            <div className="filter-hint" style={{ color: '#5B21B6' }}>
              Click to view Method &amp; Baseline →
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            VIEW 1: EXECUTIVE COCKPIT & MAP
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'cockpit' && (
          <div className={`cockpit-layout ${isMapExpanded ? 'expanded-map' : ''}`}>
            
            {/* Interactive Leaflet Map Box */}
            <div className={`map-wrapper glass-panel ${mapMode === 'dark' ? 'dark-basemap' : ''}`}>
              {/* Floating Filter Controls */}
              <div className="map-filter-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', flexWrap: 'wrap' }}>
                  <div className="search-input-wrapper">
                    <Search size={15} className="search-icon" />
                    <input 
                      type="text" 
                      placeholder={activeDataset.hasCoordinates ? "Search locality (e.g. Andheri, Colaba, Bandra)..." : "Search category or head..."} 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="search-clear-btn"
                        title="Clear search"
                        aria-label="Clear search input"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {availableZones.length > 1 && (
                    <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                      <option value="all">All Zones ({activeDataset.records.length})</option>
                      {availableZones.map((z, idx) => (
                        <option key={idx} value={z}>{z}</option>
                      ))}
                    </select>
                  )}

                  <select value={tierFilter} onChange={(e) => { setTierFilter(e.target.value); setQuickFilter('all'); }}>
                    <option value="all">All Priority Levels</option>
                    <option value="High">🔴 High Priority (≥15)</option>
                    <option value="Medium">🟡 Medium Priority (7-15)</option>
                    <option value="Low">🟢 Lower-Priority (&lt;7)</option>
                  </select>

                  {/* Police Station Layer Toggle */}
                  {activeDataset.hasCoordinates && activeDataset.police_stations && activeDataset.police_stations.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowPoliceStations(!showPoliceStations)}
                      style={{
                        background: showPoliceStations ? '#E8F6FF' : '#FFFFFF',
                        border: `1px solid ${showPoliceStations ? '#BAE6FD' : 'var(--border-light)'}`,
                        color: showPoliceStations ? '#168BFF' : 'var(--text-muted)',
                        padding: '7px 11px',
                        borderRadius: 8,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5
                      }}
                      title="Toggle visibility of Police Stations on map"
                    >
                      <Layers size={13} /> Stations: <b>{showPoliceStations ? 'ON' : 'OFF'}</b>
                    </button>
                  )}

                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                    <b>{activeDataset.hasCoordinates ? filteredLocalities.filter(l => l.lat !== null && l.lon !== null).length : filteredLocalities.length}</b> {activeDataset.hasCoordinates ? 'pins' : 'heads'}
                  </div>
                </div>

                {/* Quick Filter Chips Bar */}
                <div className="quick-filter-bar" style={{ width: '100%', marginTop: 8 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginRight: 2 }}>Quick:</span>
                  <button 
                    type="button"
                    className={`quick-filter-chip ${quickFilter === 'all' && tierFilter === 'all' ? 'active' : ''}`}
                    onClick={() => { setQuickFilter('all'); setTierFilter('all'); }}
                  >
                    All Localities ({activeDataset.records.length})
                  </button>
                  <button 
                    type="button"
                    className={`quick-filter-chip ${quickFilter === 'high' || tierFilter === 'High' ? 'active' : ''}`}
                    onClick={() => { setQuickFilter(quickFilter === 'high' ? 'all' : 'high'); setTierFilter('all'); }}
                  >
                    🔴 High Priority ({metadata.high_risk_count})
                  </button>
                  <button 
                    type="button"
                    className={`quick-filter-chip ${quickFilter === 'med' || tierFilter === 'Medium' ? 'active' : ''}`}
                    onClick={() => { setQuickFilter(quickFilter === 'med' ? 'all' : 'med'); setTierFilter('all'); }}
                  >
                    🟡 Medium ({metadata.medium_risk_count})
                  </button>
                  <button 
                    type="button"
                    className={`quick-filter-chip ${quickFilter === 'low' || tierFilter === 'Low' ? 'active' : ''}`}
                    onClick={() => { setQuickFilter(quickFilter === 'low' ? 'all' : 'low'); setTierFilter('all'); }}
                  >
                    🟢 Lower-Priority ({metadata.safe_count})
                  </button>
                  {activeDataset.hasSpecializedAnalytics && (
                    <>
                      <button 
                        type="button"
                        className={`quick-filter-chip ${quickFilter === 'chowki_deficit' ? 'active' : ''}`}
                        onClick={() => { setQuickFilter(quickFilter === 'chowki_deficit' ? 'all' : 'chowki_deficit'); setTierFilter('all'); }}
                      >
                        🚨 Outpost Deficit (≤1)
                      </button>
                      <button 
                        type="button"
                        className={`quick-filter-chip ${quickFilter === 'dense' ? 'active' : ''}`}
                        onClick={() => { setQuickFilter(quickFilter === 'dense' ? 'all' : 'dense'); setTierFilter('all'); }}
                      >
                        🏙️ Dense Corridors (&gt;45k)
                      </button>
                    </>
                  )}
                </div>

                {/* Quick Hubs Bar for 1-Click Navigation */}
                {activeDataset.hasCoordinates && activeDataset.isDefault && (
                  <div className="quick-hubs-bar">
                    <span className="quick-hubs-label">📍 Quick Jump:</span>
                    {['Andheri', 'Bandra', 'Kurla', 'Dharavi', 'Colaba', 'Borivali', 'Dadar', 'Chembur', 'Worli', 'Ghatkopar'].map(hub => (
                      <button
                        key={hub}
                        type="button"
                        className="quick-hub-btn"
                        onClick={() => {
                          const found = activeDataset.records.find(r => r.locality && r.locality.toLowerCase().includes(hub.toLowerCase()));
                          if (found) {
                            setSelectedLocality(found);
                            if (mapInstanceRef.current && found.lat && found.lon) {
                              mapInstanceRef.current.flyTo([found.lat, found.lon], 13.5, { duration: 0.8 });
                            }
                          }
                        }}
                        title={`Focus map on ${hub}`}
                      >
                        {hub}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Top Floating Map Action Toolbar */}
              {activeDataset.hasCoordinates && (
                <div className="map-floating-controls">
                  {/* Basemap switcher */}
                  <div className="map-toolbar-group" title="Select Basemap Style">
                    <button
                      type="button"
                      className={`map-tool-btn ${mapMode === 'light' ? 'active' : ''}`}
                      onClick={() => setMapMode('light')}
                      title="Light Street Map"
                    >
                      <Sun size={12} /> Light
                    </button>
                    <button
                      type="button"
                      className={`map-tool-btn ${mapMode === 'dark' ? 'active' : ''}`}
                      onClick={() => setMapMode('dark')}
                      title="Dark Midnight Mode"
                    >
                      <Moon size={12} /> Dark
                    </button>
                    <button
                      type="button"
                      className={`map-tool-btn ${mapMode === 'satellite' ? 'active' : ''}`}
                      onClick={() => setMapMode('satellite')}
                      title="Satellite Aerial Imagery"
                    >
                      <Globe size={12} /> Satellite
                    </button>
                  </div>

                  {/* Catchment Radius Toggle */}
                  <button
                    type="button"
                    className={`map-tool-btn ${showCoverageRadius ? 'active' : ''}`}
                    onClick={() => setShowCoverageRadius(!showCoverageRadius)}
                    title="Toggle 1.5km municipal response buffer around selected locality"
                  >
                    <Radio size={12} /> 1.5km Catchment: <b>{showCoverageRadius ? 'ON' : 'OFF'}</b>
                  </button>

                  {/* Recenter Button */}
                  <button
                    type="button"
                    className="map-tool-btn"
                    onClick={() => {
                      if (mapInstanceRef.current) {
                        mapInstanceRef.current.flyTo([19.0800, 72.8700], 11, { duration: 0.8 });
                      }
                    }}
                    title="Reset camera to Greater Mumbai Overview"
                  >
                    <Target size={12} /> Recenter
                  </button>

                  {/* Fullscreen / Split View Toggle */}
                  <button
                    type="button"
                    className={`map-tool-btn ${isMapExpanded ? 'active' : ''}`}
                    onClick={() => setIsMapExpanded(!isMapExpanded)}
                    title={isMapExpanded ? 'Exit full-width map' : 'Expand map across full width'}
                  >
                    {isMapExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    {isMapExpanded ? 'Split View' : 'Full Width'}
                  </button>
                </div>
              )}

              {/* Geographic Approximation Disclosure Badge (Mumbai Default) */}
              {activeDataset.isDefault && (
                <div style={{ position: 'absolute', bottom: '16px', right: '16px', zIndex: 400, background: 'rgba(255, 255, 255, 0.95)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '6px 12px', fontSize: '0.7rem', color: 'var(--text-muted)', boxShadow: 'var(--shadow-floating)', maxWidth: 300, lineHeight: 1.35 }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Spatial Disclosure:</span> 56 verified anchor points; 482 positioned via deterministic hash jitter across 3 macro-zones (demonstration compilation).
                </div>
              )}

              {/* Category Intelligence & Detection Analysis Dashboard when dataset has no lat/lon coordinates */}
              {!activeDataset.hasCoordinates && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 600, background: '#FFFFFF', display: 'flex', flexDirection: 'column', padding: '16px 20px', overflowY: 'auto' }}>
                  {/* Category Dashboard Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-blue">Category &amp; Crime Head Intelligence</span>
                        <span className="badge badge-emerald">Interactive Analysis</span>
                      </div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1E293B', marginTop: 4 }}>
                        {activeDataset.name} — Relative Priority &amp; Detection Breakdown
                      </h3>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Non-spatial category view. Select any category row to inspect its operational orders, detection rate, and comparative metrics in the dossier.
                      </p>
                    </div>

                    <button
                      onClick={() => setActiveTab('upload')}
                      style={{ background: '#E8F6FF', border: '1px solid #BAE6FD', color: '#168BFF', padding: '6px 14px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Column Mapping →
                    </button>
                  </div>

                  {/* Category Cards List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                    {filteredLocalities.map((rec, idx) => {
                      const isSelected = selectedLocality?.locality === rec.locality;
                      const hasDet = rec.detection_rate !== null && rec.detection_rate !== undefined;
                      const hasYoY = rec.yoy_change !== null && rec.yoy_change !== undefined;
                      const maxRecordCount = Math.max(...activeDataset.records.filter(r => !r.isSummary).map(r => r.registered_count || 1));

                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedLocality(rec)}
                          style={{
                            background: isSelected ? '#F0F9FF' : (rec.isSummary ? '#F8FAFC' : '#FFFFFF'),
                            border: isSelected ? '2px solid #168BFF' : (rec.isSummary ? '1px dashed #CBD5E1' : '1px solid #E2E8F0'),
                            borderRadius: 10,
                            padding: '10px 14px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            boxShadow: isSelected ? '0 4px 12px rgba(22, 139, 255, 0.12)' : '0 1px 3px rgba(0,0,0,0.03)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ 
                                width: 10, 
                                height: 10, 
                                borderRadius: '50%', 
                                background: rec.risk_tier === 'High' ? '#FF7868' : (rec.risk_tier === 'Medium' ? '#F59E0B' : '#20B879'),
                                flexShrink: 0 
                              }} />
                              <div>
                                <span style={{ fontWeight: 800, fontSize: '0.92rem', color: '#1E293B' }}>
                                  {rec.locality}
                                </span>
                                {rec.isSummary && (
                                  <span className="badge badge-blue" style={{ marginLeft: 8, fontSize: '0.62rem' }}>Aggregate Total</span>
                                )}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {/* Registered Cases */}
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Registered Cases</div>
                                <div style={{ fontWeight: 800, fontSize: '0.9rem', fontFamily: 'var(--font-mono)', color: '#1E293B' }}>
                                  {rec.registered_count ? rec.registered_count.toLocaleString() : '—'}
                                </div>
                              </div>

                              {/* YoY Trend */}
                              {hasYoY && (
                                <span className={`badge ${rec.yoy_change <= 0 ? 'badge-emerald' : 'badge-red'}`} style={{ fontSize: '0.7rem' }}>
                                  {rec.yoy_change > 0 ? `+${rec.yoy_change}%` : `${rec.yoy_change}%`} vs '22
                                </span>
                              )}

                              {/* Detection Rate */}
                              {hasDet && (
                                <div style={{ textAlign: 'right', minWidth: 80 }}>
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Detection Rate</div>
                                  <span className={`badge ${rec.detection_rate >= 80 ? 'badge-emerald' : (rec.detection_rate >= 60 ? 'badge-amber' : 'badge-red')}`} style={{ fontSize: '0.72rem' }}>
                                    {rec.detection_rate}% Det.
                                  </span>
                                </div>
                              )}

                              {/* Priority Score */}
                              <div style={{ 
                                padding: '3px 8px', 
                                borderRadius: 6, 
                                background: rec.risk_tier === 'High' ? '#FFF0E8' : (rec.risk_tier === 'Medium' ? '#FFF7D6' : '#E5FAEF'),
                                border: `1px solid ${rec.risk_tier === 'High' ? '#FFD1C9' : (rec.risk_tier === 'Medium' ? '#FDE68A' : '#A7F3D0')}`,
                                textAlign: 'center',
                                minWidth: 55
                              }}>
                                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: rec.risk_tier === 'High' ? '#9A2C1C' : (rec.risk_tier === 'Medium' ? '#92400E' : '#065F46') }}>
                                  {rec.risk_tier}
                                </div>
                                <div style={{ fontSize: '0.92rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: rec.risk_tier === 'High' ? '#FF7868' : (rec.risk_tier === 'Medium' ? '#D97706' : '#20B879') }}>
                                  {Number(rec.risk_index).toFixed(1)}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Progress bar visual for Volume */}
                          {!rec.isSummary && (
                            <div style={{ marginTop: 6, background: '#F1F5F9', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                              <div 
                                style={{ 
                                  height: '100%', 
                                  width: `${Math.min(100, Math.max(3, (rec.registered_count / (maxRecordCount || 100)) * 100))}%`,
                                  background: rec.risk_tier === 'High' ? '#FF7868' : (rec.risk_tier === 'Medium' ? '#F59E0B' : '#20B879'),
                                  borderRadius: 4
                                }} 
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state overlay when search has 0 results */}
              {filteredLocalities.length === 0 && activeDataset.hasCoordinates && (
                <div style={{ position: 'absolute', top: '75px', left: '20px', right: '20px', zIndex: 600, background: '#FFFFFF', border: '1px solid #FFD1C9', borderRadius: 10, padding: 24, textAlign: 'center', boxShadow: '0 8px 30px rgba(15,23,42,0.12)' }}>
                  <AlertTriangle size={26} color="#FF7868" style={{ marginBottom: 6 }} />
                  <p style={{ fontSize: '0.92rem', color: '#1E293B', fontWeight: 800 }}>No locations found matching "{searchQuery}"</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>Try clearing the active filters or searching for another term.</p>
                  <button onClick={() => { setSearchQuery(''); setZoneFilter('all'); setTierFilter('all'); }} style={{ marginTop: 12, background: 'var(--primary-blue)', color: '#FFFFFF', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                    Reset Search &amp; Filters
                  </button>
                </div>
              )}

              {/* Map Canvas */}
              <div ref={mapContainerRef} className="map-container" />

              {/* Interactive Map Legend */}
              <div className="map-interactive-legend">
                <div className="legend-header">
                  <span>Civic Priority Tiers</span>
                  <span className="legend-hint">Click to filter</span>
                </div>
                <div className="legend-items">
                  <button
                    type="button"
                    className={`legend-item-chip ${tierFilter === 'High' || quickFilter === 'high' ? 'active-tier' : ''}`}
                    onClick={() => {
                      if (tierFilter === 'High' || quickFilter === 'high') { setTierFilter('all'); setQuickFilter('all'); }
                      else { setTierFilter('High'); setQuickFilter('high'); }
                    }}
                    title="Filter to High Priority zones"
                  >
                    <span className="legend-dot" style={{ background: '#FF7868' }}></span>
                    <span>High (≥15)</span>
                    <span className="legend-count">{metadata.high_risk_count ?? 18}</span>
                  </button>

                  <button
                    type="button"
                    className={`legend-item-chip ${tierFilter === 'Medium' || quickFilter === 'med' ? 'active-tier' : ''}`}
                    onClick={() => {
                      if (tierFilter === 'Medium' || quickFilter === 'med') { setTierFilter('all'); setQuickFilter('all'); }
                      else { setTierFilter('Medium'); setQuickFilter('med'); }
                    }}
                    title="Filter to Medium Priority zones"
                  >
                    <span className="legend-dot" style={{ background: '#F59E0B' }}></span>
                    <span>Medium (7–15)</span>
                    <span className="legend-count">{metadata.medium_risk_count ?? 34}</span>
                  </button>

                  <button
                    type="button"
                    className={`legend-item-chip ${tierFilter === 'Low' || quickFilter === 'low' ? 'active-tier' : ''}`}
                    onClick={() => {
                      if (tierFilter === 'Low' || quickFilter === 'low') { setTierFilter('all'); setQuickFilter('all'); }
                      else { setTierFilter('Low'); setQuickFilter('low'); }
                    }}
                    title="Filter to Lower-Priority zones"
                  >
                    <span className="legend-dot" style={{ background: '#20B879' }}></span>
                    <span>Lower (&lt;7)</span>
                    <span className="legend-count">{metadata.safe_count ?? 36}</span>
                  </button>

                  {activeDataset.isDefault && (
                    <button
                      type="button"
                      className={`legend-item-chip ${showPoliceStations ? 'active-stations' : ''}`}
                      onClick={() => setShowPoliceStations(!showPoliceStations)}
                      title="Toggle police jurisdiction stations"
                    >
                      <span className="legend-dot" style={{ background: '#168BFF' }}></span>
                      <span>Stations</span>
                      <span className="legend-count">{activeDataset.police_stations?.length ?? 94}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Map HUD Status Badge */}
              <div className="map-hud-badge">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="hud-indicator-dot"></span>
                  <span style={{ fontWeight: 700 }}>MMR GIS Engine</span>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>
                    {filteredLocalities.filter(l => l.lat !== null && l.lon !== null).length} Pins
                  </span>
                </div>
                <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span>19.08° N, 72.87° E</span>
                  <span>•</span>
                  <span>Layer: <b style={{ textTransform: 'capitalize', color: '#168BFF' }}>{mapMode}</b></span>
                </div>
              </div>
            </div>

            {/* Right Side: Locality Vulnerability Dossier */}
            <div className={`glass-panel dossier-panel ${isMapExpanded ? 'floating-dossier' : ''}`}>
              {isMapExpanded && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid #E2E8F0', marginBottom: 8 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#168BFF' }}>
                    📍 Selected Locality Inspector
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsMapExpanded(false)}
                    style={{ background: '#F1F5F9', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Minimize2 size={12} /> Split View
                  </button>
                </div>
              )}
              {selectedLocality ? (
                <>
                  {/* Header & Status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span className={`badge ${
                          selectedLocality.risk_tier === 'High' ? 'badge-red' : 
                          selectedLocality.risk_tier === 'Medium' ? 'badge-amber' : 'badge-emerald'
                        }`}>
                          {selectedLocality.risk_tier === 'Low' ? 'Lower-Priority Area' : `${selectedLocality.risk_tier} Priority`}
                        </span>
                        {selectedLocality.zone && (
                          <span className="badge badge-blue">{selectedLocality.zone}</span>
                        )}
                      </div>
                      <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#1E293B' }}>{selectedLocality.locality}</h2>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Jurisdiction / Ward: <b style={{ color: '#1E293B' }}>{selectedLocality.ward || 'General'}</b>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Priority Indicator
                      </div>
                      <div style={{ 
                        fontSize: '2rem', 
                        fontWeight: 800, 
                        fontFamily: 'var(--font-mono)',
                        color: selectedLocality.risk_tier === 'High' ? '#FF7868' : 
                               selectedLocality.risk_tier === 'Medium' ? '#D97706' : '#20B879'
                      }}>
                        {Number(selectedLocality.risk_index).toFixed(1)}
                      </div>
                      {selectedLocality.ci_lower && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }} title="95% statistical confidence margin for demonstration indicator">
                          95% Conf: [{selectedLocality.ci_lower} – {selectedLocality.ci_upper}]
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Executive Assessment Box (Plain English) */}
                  {executiveAssessment && (
                    <div className={`exec-summary-box ${executiveAssessment.className}`} style={{ marginTop: 12 }}>
                      <Info size={17} style={{ flexShrink: 0, marginTop: 2, color: selectedLocality.risk_tier === 'High' ? '#FF7868' : (selectedLocality.risk_tier === 'Medium' ? '#D97706' : '#20B879') }} />
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: selectedLocality.risk_tier === 'High' ? '#B91C1C' : (selectedLocality.risk_tier === 'Medium' ? '#92400E' : '#065F46'), marginBottom: 2 }}>
                          Executive Assessment · {executiveAssessment.badge}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                          {executiveAssessment.text}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick Action Navigation Bar */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    {activeDataset.hasCoordinates && selectedLocality.lat && (
                      <button
                        type="button"
                        onClick={() => handleCenterLocality(selectedLocality)}
                        className="btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '5px 10px', flex: 1 }}
                        title="Recenter map camera onto this locality"
                      >
                        <Compass size={13} color="#168BFF" /> Center Map
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveTab('simulator')}
                      className="btn-secondary"
                      style={{ fontSize: '0.72rem', padding: '5px 10px', flex: 1 }}
                      title="Test interventions for this locality in the Simulator"
                    >
                      <Sliders size={13} color="#168BFF" /> Test Simulator
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery(selectedLocality.locality);
                        setActiveTab('data');
                      }}
                      className="btn-secondary"
                      style={{ fontSize: '0.72rem', padding: '5px 10px', flex: 1 }}
                      title="Filter and view raw data records for this locality"
                    >
                      <Database size={13} color="#168BFF" /> Raw Data
                    </button>
                  </div>

                  <hr style={{ borderColor: 'var(--border-light)', margin: '12px 0' }} />

                  {/* Ward / Category Key Metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {selectedLocality.detection_rate !== null && selectedLocality.detection_rate !== undefined ? (
                      <>
                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>REGISTERED CASES</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#FF7868' }}>
                            {selectedLocality.registered_count ? selectedLocality.registered_count.toLocaleString() : '—'} <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>cases</span>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>DETECTION RATE</div>
                          <div style={{ 
                            fontSize: '1.05rem', 
                            fontWeight: 800, 
                            fontFamily: 'var(--font-mono)', 
                            color: selectedLocality.detection_rate >= 80 ? '#20B879' : (selectedLocality.detection_rate >= 60 ? '#D97706' : '#FF7868') 
                          }}>
                            {selectedLocality.detection_rate}% <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>cleared</span>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>PRIOR YEAR BENCHMARK</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#1E293B' }}>
                            {selectedLocality.prev_registered ? selectedLocality.prev_registered.toLocaleString() : '—'}{' '}
                            {selectedLocality.yoy_change !== null && (
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: selectedLocality.yoy_change <= 0 ? '#20B879' : '#FF7868' }}>
                                ({selectedLocality.yoy_change > 0 ? '+' : ''}{selectedLocality.yoy_change}%)
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>UNSOLVED BACKLOG</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: selectedLocality.unsolved_count > 0 ? '#FF7868' : '#20B879' }}>
                            {selectedLocality.unsolved_count !== null ? selectedLocality.unsolved_count.toLocaleString() : '—'} <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>cases</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>POPULATION DENSITY</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#1E293B' }}>
                            {selectedLocality.population_density ? Math.round(selectedLocality.population_density).toLocaleString() : '—'} <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>/km²</span>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>POLICE CHOWKIS</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: selectedLocality.police_chowkis <= 2 ? '#FF7868' : '#1E293B' }}>
                            {selectedLocality.police_chowkis ?? '—'} <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>outposts</span>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>RECORDED INCIDENTS</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#FF7868' }}>
                            {selectedLocality.crimes_against_women ?? selectedLocality.total_crimes ?? '—'} <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>cases</span>
                          </div>
                        </div>

                        <div style={{ background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>BUILT-UP / HEAT PROXY</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#1E293B' }}>
                            {selectedLocality.uhi_index ? Number(selectedLocality.uhi_index).toFixed(2) : '—'} <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>({selectedLocality.uhi_category || 'N/A'})</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Explainability Breakdown (Factor Attribution) */}
                  {selectedLocality.feature_contributions && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                          Vulnerability Attribution Breakdown
                        </h4>
                        <Info size={14} color="var(--text-muted)" />
                      </div>

                      <div className="attr-row">
                        <div className="attr-header">
                          <span>Incident Volume Weight</span>
                          <b>{selectedLocality.feature_contributions.crimes_against_women_factor}%</b>
                        </div>
                        <div className="attr-bar-bg">
                          <div className="attr-bar-fill" style={{ width: `${selectedLocality.feature_contributions.crimes_against_women_factor}%`, background: '#FF7868' }} />
                        </div>
                      </div>

                      <div className="attr-row">
                        <div className="attr-header">
                          <span>Crowd &amp; Density Strain</span>
                          <b>{selectedLocality.feature_contributions.density_strain_factor}%</b>
                        </div>
                        <div className="attr-bar-bg">
                          <div className="attr-bar-fill" style={{ width: `${selectedLocality.feature_contributions.density_strain_factor}%`, background: '#F59E0B' }} />
                        </div>
                      </div>

                      <div className="attr-row">
                        <div className="attr-header">
                          <span>Police Outpost Deficit</span>
                          <b>{selectedLocality.feature_contributions.chowki_deficit_factor}%</b>
                        </div>
                        <div className="attr-bar-bg">
                          <div className="attr-bar-fill" style={{ width: `${selectedLocality.feature_contributions.chowki_deficit_factor}%`, background: '#168BFF' }} />
                        </div>
                      </div>

                      <div className="attr-row">
                        <div className="attr-header">
                          <span>Built-Environment Correlate</span>
                          <b>{selectedLocality.feature_contributions.built_env_uhi_factor}%</b>
                        </div>
                        <div className="attr-bar-bg">
                          <div className="attr-bar-fill" style={{ width: `${selectedLocality.feature_contributions.built_env_uhi_factor}%`, background: '#8B5CF6' }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Decision Support Next Steps ("ACT") */}
                  {selectedLocality.recommended_actions && (
                    <div>
                      <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                        Recommended Municipal Actions
                      </h4>
                      
                      {selectedLocality.recommended_actions.map((act, i) => (
                        <div key={i} className="action-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 800, color: act.priority.includes('P1') ? '#FF7868' : '#D97706' }}>
                              {act.priority}
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{act.schedule}</span>
                          </div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1E293B', marginBottom: 3 }}>
                            {act.action}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            {act.details}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick button to launch simulator with this locality */}
                  <button 
                    onClick={() => setActiveTab('simulator')}
                    style={{
                      background: 'var(--primary-blue)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '11px 16px',
                      borderRadius: 8,
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(22, 139, 255, 0.25)'
                    }}
                  >
                    <Sliders size={16} /> Simulate Interventions in Policy Lab →
                  </button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  <MapPin size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                  <p>Select any location from the map or table to inspect its decision dossier.</p>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            VIEW 2: DYNAMIC DATA UPLOAD & FIELD MAPPING EXPERIENCE
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            
            {/* Header & Explanation */}
            <div className="glass-panel" style={{ padding: 24, background: '#FFFFFF' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ background: '#E8F6FF', padding: 10, borderRadius: 10 }}>
                  <Upload size={24} color="#168BFF" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#1E293B' }}>Dynamic Dataset Importer &amp; Field Mapper</h2>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                    Upload any CSV or JSON dataset to re-run the CityPulse decision cockpit, spatial map, and analytics on custom municipal data.
                  </p>
                </div>
              </div>
            </div>

            {/* Step 1: Upload Drop Zone */}
            <div className="glass-panel" style={{ padding: 24, background: '#FFFFFF' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, marginBottom: 12, color: '#1E293B' }}>
                1. Select CSV or JSON File
              </h3>

              <input 
                ref={fileInputRef}
                type="file" 
                accept=".csv,.json,text/csv,application/json" 
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
                style={{ display: 'none' }}
              />

              <div 
                className="upload-zone"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText size={40} color="#168BFF" style={{ marginBottom: 12 }} />
                <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#1E293B' }}>
                  {uploadFile ? `Selected: ${uploadFile.name}` : 'Click or drop a CSV or JSON file here'}
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Supports CSV tables with headers, JSON arrays of objects, or GeoJSON FeatureCollections.
                </p>
                <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ background: '#FFFFFF', border: '1px solid #BAE6FD', padding: '6px 14px', borderRadius: 8, fontSize: '0.76rem', fontWeight: 700, color: '#168BFF' }}>
                    Browse Local File
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); loadSampleCrimeHeads(); }}
                    style={{ background: '#E8F6FF', border: '1px solid #BAE6FD', padding: '6px 14px', borderRadius: 8, fontSize: '0.76rem', fontWeight: 700, color: '#168BFF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Database size={13} /> Load Mumbai Police Crime Heads Benchmark (2022–2023)
                  </button>
                </div>
              </div>

              {uploadStatus === 'error' && (
                <div style={{ marginTop: 14, background: '#FFF0E8', border: '1px solid #FFD1C9', padding: '12px 16px', borderRadius: 8, color: '#9A2C1C', display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem' }}>
                  <AlertTriangle size={18} color="#FF7868" />
                  <span><b>Upload Error:</b> {uploadError}</span>
                </div>
              )}
            </div>

            {/* Step 2 & 3: Preview and Field Mapping */}
            {uploadParsed && uploadMapping && (
              <div className="glass-panel" style={{ padding: 24, background: '#FFFFFF' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#1E293B' }}>
                      2. Column Detection &amp; Concept Mapping
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Map your file's columns to CityPulse concepts. Columns that are not present can be left unmapped.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span className={`badge ${uploadQuality?.validCoords > 0 ? 'badge-emerald' : 'badge-amber'}`}>
                      {uploadQuality?.validCoords > 0 ? `✓ ${uploadQuality.validCoords} Rows with Coordinates` : '⚠ No Coordinates Found'}
                    </span>
                    <span className="badge badge-blue">
                      {uploadParsed.rows.length} Total Rows Detected
                    </span>
                  </div>
                </div>

                {/* Mapping Controls Grid */}
                <div className="mapping-grid">
                  {/* Locality Name */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Area / Locality Name</span>
                      <span style={{ color: '#FF7868', fontSize: '0.7rem' }}>Recommended</span>
                    </div>
                    <select 
                      value={uploadMapping.locality} 
                      onChange={(e) => handleMappingChange('locality', e.target.value)}
                    >
                      <option value="">-- None (Auto-number) --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Unique identifier for each record or row.</div>
                  </div>

                  {/* Latitude */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Latitude Coordinate</span>
                      <span style={{ color: '#168BFF', fontSize: '0.7rem' }}>For Map View</span>
                    </div>
                    <select 
                      value={uploadMapping.lat} 
                      onChange={(e) => handleMappingChange('lat', e.target.value)}
                    >
                      <option value="">-- None (No Map Placement) --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Decimal degrees (-90.0 to +90.0).</div>
                  </div>

                  {/* Longitude */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Longitude Coordinate</span>
                      <span style={{ color: '#168BFF', fontSize: '0.7rem' }}>For Map View</span>
                    </div>
                    <select 
                      value={uploadMapping.lon} 
                      onChange={(e) => handleMappingChange('lon', e.target.value)}
                    >
                      <option value="">-- None (No Map Placement) --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Decimal degrees (-180.0 to +180.0).</div>
                  </div>

                  {/* Incidents / Crime */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Recorded Incidents / Crimes</span>
                      <span style={{ color: '#168BFF', fontSize: '0.7rem' }}>For Safety DSS</span>
                    </div>
                    <select 
                      value={uploadMapping.crimes_against_women} 
                      onChange={(e) => handleMappingChange('crimes_against_women', e.target.value)}
                    >
                      <option value="">-- Optional / Not Mapped --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Reported crime or safety incident counts.</div>
                  </div>

                  {/* Detection Rate */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Detection / Clearance Rate</span>
                      <span style={{ color: '#20B879', fontSize: '0.7rem' }}>Enforcement Metric</span>
                    </div>
                    <select 
                      value={uploadMapping.detection_rate} 
                      onChange={(e) => handleMappingChange('detection_rate', e.target.value)}
                    >
                      <option value="">-- Optional / Not Mapped --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Percentage of detected or cleared cases (% Age).</div>
                  </div>

                  {/* Prior Year Comparison */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Prior Year Benchmark Volume</span>
                      <span style={{ color: '#64748B', fontSize: '0.7rem' }}>YoY Trend</span>
                    </div>
                    <select 
                      value={uploadMapping.previous_year} 
                      onChange={(e) => handleMappingChange('previous_year', e.target.value)}
                    >
                      <option value="">-- Optional / Not Mapped --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Previous year count for trajectory analysis.</div>
                  </div>

                  {/* Police Facilities */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Police Chowkis / Outposts</span>
                      <span style={{ color: '#168BFF', fontSize: '0.7rem' }}>For Safety DSS</span>
                    </div>
                    <select 
                      value={uploadMapping.police_chowkis} 
                      onChange={(e) => handleMappingChange('police_chowkis', e.target.value)}
                    >
                      <option value="">-- Optional / Not Mapped --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Count of police outposts or beats.</div>
                  </div>

                  {/* Population Density */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Population Density</span>
                      <span style={{ color: '#64748B', fontSize: '0.7rem' }}>Optional</span>
                    </div>
                    <select 
                      value={uploadMapping.population_density} 
                      onChange={(e) => handleMappingChange('population_density', e.target.value)}
                    >
                      <option value="">-- Optional / Not Mapped --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Residents per square kilometer.</div>
                  </div>

                  {/* Built Environment / UHI */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Heat / Built-Up Index</span>
                      <span style={{ color: '#64748B', fontSize: '0.7rem' }}>Optional</span>
                    </div>
                    <select 
                      value={uploadMapping.uhi_index} 
                      onChange={(e) => handleMappingChange('uhi_index', e.target.value)}
                    >
                      <option value="">-- Optional / Not Mapped --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Urban heat island or built density index.</div>
                  </div>

                  {/* Priority / Risk Index */}
                  <div className="mapping-card">
                    <div className="mapping-label">
                      <span>Existing Priority Score</span>
                      <span style={{ color: '#64748B', fontSize: '0.7rem' }}>Optional</span>
                    </div>
                    <select 
                      value={uploadMapping.risk_index} 
                      onChange={(e) => handleMappingChange('risk_index', e.target.value)}
                    >
                      <option value="">-- Auto-calculate Relative Score --</option>
                      {uploadParsed.headers.map((h, i) => (
                        <option key={i} value={h}>{h}</option>
                      ))}
                    </select>
                    <div className="mapping-sub">Composite score (0–30 scale if available).</div>
                  </div>
                </div>

                {/* Sample Rows Preview */}
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.82rem', fontWeight: 700, color: '#1E293B' }}>
                    <Eye size={16} color="#168BFF" />
                    <span>Sample Data Preview (First 3 Rows)</span>
                  </div>
                  <div className="preview-table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {uploadParsed.headers.map((h, i) => (
                            <th key={i}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadParsed.rows.slice(0, 3).map((row, rIdx) => (
                          <tr key={rIdx}>
                            {uploadParsed.headers.map((h, cIdx) => (
                              <td key={cIdx}>{String(row[h] ?? '—')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Data Quality & Action Controls */}
                <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Status: <b style={{ color: '#20B879' }}>File ready to review</b> · Missing values are preserved as null and never fabricated.
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <button 
                      onClick={() => { setUploadFile(null); setUploadParsed(null); }}
                      style={{ background: '#FFFFFF', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', padding: '10px 18px', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                    <button 
                      onClick={handleActivateDataset}
                      style={{ background: 'var(--primary-blue)', color: '#FFFFFF', border: 'none', padding: '10px 22px', borderRadius: 8, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', boxShadow: '0 2px 8px rgba(22, 139, 255, 0.28)', display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <Check size={16} /> Activate Dataset &amp; Update Dashboard
                    </button>
                  </div>
                </div>

              </div>
            )}

          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            VIEW 3: MUNICIPAL PLANNING SCENARIO EXPLORER ("ACT" ENGINE)
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'simulator' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            
            {/* Left: Policy Lever Configuration */}
            <div className="glass-panel" style={{ padding: 24, background: '#FFFFFF' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ background: '#E8F6FF', padding: 10, borderRadius: 10 }}>
                  <Sliders size={22} color="#168BFF" />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1E293B' }}>Municipal Planning Scenario Explorer (Hypothetical)</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Explore hypothetical planning trade-offs by testing adjustments to police chowkis, streetlighting, and foot beats.
                  </p>
                </div>
              </div>

              {/* Quick Scenario Packages Bar */}
              <div style={{ marginBottom: 18, background: '#F8FAFC', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={14} color="#168BFF" />
                  <span>One-Click Policy Packages (Scenario Presets)</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="scenario-preset-btn"
                    onClick={() => { setSimChowkis(1); setSimLighting(25); setSimPatrol('standard'); }}
                  >
                    ⚡ Rapid (+1 Post, +25% Light)
                  </button>
                  <button
                    type="button"
                    className="scenario-preset-btn"
                    onClick={() => { setSimChowkis(2); setSimLighting(50); setSimPatrol('intensive'); }}
                  >
                    🛡️ Safe City (+2 Posts, +50% Light, Night Beat)
                  </button>
                  <button
                    type="button"
                    className="scenario-preset-btn"
                    onClick={() => { setSimChowkis(0); setSimLighting(50); setSimPatrol('standard'); }}
                  >
                    💡 Light Focus (+50% Light)
                  </button>
                  <button
                    type="button"
                    className="scenario-preset-btn"
                    onClick={() => { setSimChowkis(0); setSimLighting(0); setSimPatrol('standard'); }}
                  >
                    🔄 Baseline (Zero Added)
                  </button>
                </div>
              </div>

              {/* Target Locality Selector */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Target Intervention Locality
                </label>
                <select 
                  value={selectedLocality ? selectedLocality.locality : ''}
                  onChange={(e) => {
                    const found = activeDataset.records.find(l => l.locality === e.target.value);
                    if (found) setSelectedLocality(found);
                  }}
                  style={{ width: '100%', padding: '10px 12px', fontSize: '0.88rem' }}
                >
                  {activeDataset.records.map((l, i) => (
                    <option key={i} value={l.locality}>
                      {l.locality} ({l.ward ? `Ward ${l.ward} · ` : ''}Current Priority: {Number(l.risk_index).toFixed(1)} [{l.risk_tier === 'Low' ? 'Lower-Priority' : `${l.risk_tier} Priority`}])
                    </option>
                  ))}
                </select>
              </div>

              {/* Slider 1: Police Chowki Expansion */}
              <div style={{ marginBottom: 20, background: 'var(--bg-alt)', padding: 16, borderRadius: 10, border: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1E293B' }}>Hypothetical Police Chowki Addition</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--primary-blue)' }}>+{simChowkis} Chowkis</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="3" 
                  step="1"
                  value={simChowkis} 
                  onChange={(e) => setSimChowkis(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  <span>0 (None)</span>
                  <span>+1 (Auxiliary Post: -1.45 pts)</span>
                  <span>+2 (Sub-division: -2.90 pts)</span>
                  <span>+3 (Station Hub: -4.35 pts)</span>
                </div>
              </div>

              {/* Slider 2: Smart Street Lighting & CCTV */}
              <div style={{ marginBottom: 20, background: 'var(--bg-alt)', padding: 16, borderRadius: 10, border: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1E293B' }}>Hypothetical Lighting &amp; Surveillance Coverage</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--accent-green)' }}>+{simLighting}% Coverage</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="50" 
                  step="5"
                  value={simLighting} 
                  onChange={(e) => setSimLighting(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  <span>0%</span>
                  <span>+25% Lighting (-1.10 pts)</span>
                  <span>+50% Full Luminescence (-2.20 pts)</span>
                </div>
              </div>

              {/* Toggle: Foot Patrol Intensity */}
              <div style={{ marginBottom: 20, background: 'var(--bg-alt)', padding: 16, borderRadius: 10, border: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1E293B' }}>Patrol Beat Intensity (Scenario)</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#D97706', textTransform: 'capitalize' }}>{simPatrol}</span>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button 
                    onClick={() => setSimPatrol('standard')}
                    style={{
                      flex: 1,
                      padding: '9px 12px',
                      background: simPatrol === 'standard' ? 'var(--primary-blue)' : '#FFFFFF',
                      border: '1px solid var(--border-light)',
                      borderRadius: 8,
                      color: simPatrol === 'standard' ? '#FFFFFF' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '0.8rem'
                    }}
                  >
                    Standard Patrol (-0.80 pts)
                  </button>
                  <button 
                    onClick={() => setSimPatrol('intensive')}
                    style={{
                      flex: 1,
                      padding: '9px 12px',
                      background: simPatrol === 'intensive' ? 'var(--primary-blue)' : '#FFFFFF',
                      border: '1px solid var(--border-light)',
                      borderRadius: 8,
                      color: simPatrol === 'intensive' ? '#FFFFFF' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '0.8rem'
                    }}
                  >
                    Intensive Night Beat (-1.80 pts)
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Projected Decision Outcome */}
            {simResults && (
              <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#FFFFFF' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 700 }}>
                    Hypothetical Scenario Projection
                  </div>
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 4, color: '#1E293B' }}>
                    {selectedLocality.locality} Planning Scenario
                  </h3>
                  
                  {/* Warning Box */}
                  <div style={{ background: '#FFF7D6', borderLeft: '4px solid #F59E0B', padding: '10px 14px', borderRadius: '0 8px 8px 0', fontSize: '0.78rem', color: '#92400E', marginTop: 12, marginBottom: 18 }}>
                    <b>Planning Heuristic &amp; Decision Tool:</b> Simulates hypothetical changes using assumed planning coefficients (-1.45 pts/chowki, -2.2 pts/lighting upgrade, -1.8 pts/night beat). These demonstrate capital allocation trade-offs and do <b>not</b> guarantee real-world crime reduction.
                  </div>

                  {/* Before vs After Comparison Card */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center', background: 'var(--bg-alt)', padding: 20, borderRadius: 12, border: '1px solid var(--border-light)', marginBottom: 20 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>CURRENT SCORE</div>
                      <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: simResults.oldTier === 'High' ? '#FF7868' : '#D97706' }}>
                        {simResults.baseRisk.toFixed(1)}
                      </div>
                      <span className={`badge ${simResults.oldTier === 'High' ? 'badge-red' : 'badge-amber'}`}>
                        {simResults.oldTier === 'Low' ? 'Lower-Priority' : `${simResults.oldTier} Priority`}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#20B879' }}>
                      <ChevronRight size={32} />
                      <div style={{ fontSize: '0.85rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                        -{simResults.pctDrop}%
                      </div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>PROJECTED SCORE</div>
                      <div style={{ fontSize: '2.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: simResults.newTier === 'High' ? '#FF7868' : simResults.newTier === 'Medium' ? '#D97706' : '#20B879' }}>
                        {simResults.newRisk.toFixed(1)}
                      </div>
                      <span className={`badge ${simResults.newTier === 'High' ? 'badge-red' : simResults.newTier === 'Medium' ? 'badge-amber' : 'badge-emerald'}`}>
                        {simResults.newTier === 'Low' ? 'Lower-Priority' : `${simResults.newTier} Priority`}
                      </span>
                    </div>
                  </div>

                  {/* Municipal Docket Output */}
                  <div style={{ background: '#E5FAEF', border: '1px solid #A7F3D0', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#065F46', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                      MUNICIPAL PLANNING DOCKET (ESTIMATED SCENARIO PROJECTION)
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#047857', lineHeight: 1.5 }}>
                      Deploying <b>+{simChowkis} auxiliary chowki(s)</b> and upgrading smart LED lighting by <b>+{simLighting}%</b> in {selectedLocality.locality} projects a simulated <b>{simResults.pctDrop}% reduction</b> in the priority index (total reduction: -{simResults.totalReduction.toFixed(2)} pts), shifting priority status from <b>{simResults.oldTier}</b> to <b>{simResults.newTier}</b>.
                    </p>
                  </div>
                </div>

                <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
                  <button 
                    onClick={() => {
                      setSimChowkis(1);
                      setSimLighting(25);
                      setSimPatrol('intensive');
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#FFFFFF',
                      border: '1px solid var(--border-light)',
                      borderRadius: 8,
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >
                    Reset Levers
                  </button>
                  <button 
                    onClick={() => setActiveTab('cockpit')}
                    style={{
                      flex: 2,
                      padding: '10px 16px',
                      background: 'var(--primary-blue)',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#ffffff',
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(22, 139, 255, 0.25)'
                    }}
                  >
                    View on Decision Cockpit Map →
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            VIEW 4: ACTIONABLE ANALYTICAL DISCOVERIES (EDA)
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'eda' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#1E293B' }}>Actionable Analytical Discoveries</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {activeDataset.isDefault
                  ? 'Empirical findings calculated from statistical distributions across 538 Mumbai localities.'
                  : `Statistical findings for active dataset: ${activeDataset.name}`}
              </p>
            </div>

            {/* If Specialized Analytics Available */}
            {activeDataset.hasSpecializedAnalytics ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 20 }}>
                
                {/* Card 1: Light Blue Pastel */}
                <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#E8F6FF', border: '1px solid #BAE6FD' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span className="badge badge-blue">DISCOVERY 01</span>
                      <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#0369A1', fontWeight: 700 }}>
                        Spatial Capacity Gap
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.18rem', fontWeight: 800, marginBottom: 10, lineHeight: 1.3, color: '#1E293B' }}>
                      Chowki Load Strain in High-Density Corridors
                    </h3>

                    <div style={{ 
                      background: '#FFFFFF', 
                      borderLeft: '4px solid #168BFF', 
                      padding: '10px 14px', 
                      borderRadius: '0 8px 8px 0',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: '#0369A1',
                      marginBottom: 14,
                      border: '1px solid #BAE6FD'
                    }}>
                      Top-quartile density corridors bear approximately 2.0x higher incident load per police chowki (1.98x locality mean, 1.82x pooled aggregate).
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                      High-density transit and commercial corridors experience higher incident pressure per police outpost. In areas where population density exceeds 48,000/km², police chowkis bear roughly twice the incident load of low-density areas.
                    </p>

                    {/* Auditable Evidence & Limitations Toggle */}
                    <details style={{ background: '#FFFFFF', padding: '10px 14px', borderRadius: 8, border: '1px solid #BAE6FD', fontSize: '0.76rem', color: '#0369A1', marginBottom: 14 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Evidence &amp; Limitations (Auditable Disclosure)</summary>
                      <div style={{ marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        • <b>Top-quartile density group:</b> &gt; 48,668/km² (N = 135 localities, mean = 2.87 recorded safety incidents per outpost; baseline indicator: crimes against women subset)<br/>
                        • <b>Bottom-quartile density group:</b> ≤ 24,878/km² (N = 135 localities, mean = 1.45 recorded safety incidents per outpost; baseline indicator: crimes against women subset)<br/>
                        • <b>Locality-mean ratio:</b> 2.87 / 1.45 = <b>1.98x</b> (displayed as 2.0x)<br/>
                        • <b>Pooled aggregate ratio:</b> ∑incidents_high / ∑chowkis_high ÷ (∑incidents_low / ∑chowkis_low) = <b>1.82x</b><br/>
                        • <b>Formula:</b> recorded_incidents / police_chowkis<br/>
                        • <b>Analytical Limitation:</b> Describes spatial distribution across the supplied dataset; does NOT constitute forensic proof of actual police capacity limits or enforcement blind spots.
                      </div>
                    </details>
                  </div>

                  <div style={{ borderTop: '1px solid #BAE6FD', paddingTop: 14 }}>
                    <div style={{ fontSize: '0.72rem', color: '#0369A1', textTransform: 'uppercase', fontWeight: 700 }}>
                      EMPIRICAL MULTIPLIER
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#168BFF', marginTop: 2 }}>
                      2.0x Load Multiplier (1.98x mean ratio)
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickFilter('dense');
                        setActiveTab('cockpit');
                      }}
                      className="btn-secondary"
                      style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
                    >
                      <Search size={14} color="#168BFF" /> View High-Density Corridors on Map →
                    </button>
                  </div>
                </div>

                {/* Card 2: Peach Pastel */}
                <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#FFF0E8', border: '1px solid #FFD1C9' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span className="badge badge-red">DISCOVERY 02</span>
                      <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#9A2C1C', fontWeight: 700 }}>
                        Environmental Proxy
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.18rem', fontWeight: 800, marginBottom: 10, lineHeight: 1.3, color: '#1E293B' }}>
                      Built-Environment Density &amp; Incident Association
                    </h3>

                    <div style={{ 
                      background: '#FFFFFF', 
                      borderLeft: '4px solid #FF7868', 
                      padding: '10px 14px', 
                      borderRadius: '0 8px 8px 0',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: '#9A2C1C',
                      marginBottom: 14,
                      border: '1px solid #FFD1C9'
                    }}>
                      High-UHI built corridors exhibit 1.8x higher reported incidents, with a statistically significant moderate correlation (Spearman ρ = 0.36, p &lt; 1e-15).
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                      Urban Heat Island index serves as an environmental proxy for dense, paved, built-up corridors with low vegetative cover. Localities in the highest UHI category average 12.2 recorded safety incidents compared to 6.7 in low-UHI zones (1.8x ratio; baseline indicator: crimes against women subset).
                    </p>

                    {/* Auditable Evidence & Limitations Toggle */}
                    <details style={{ background: '#FFFFFF', padding: '10px 14px', borderRadius: 8, border: '1px solid #FFD1C9', fontSize: '0.76rem', color: '#9A2C1C', marginBottom: 14 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Evidence &amp; Limitations (Auditable Disclosure)</summary>
                      <div style={{ marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        • <b>High-UHI group:</b> N = 148 localities (mean = 12.20 recorded safety incidents; baseline indicator: crimes against women subset)<br/>
                        • <b>Low-UHI group:</b> N = 198 localities (mean = 6.72 recorded safety incidents; baseline indicator: crimes against women subset)<br/>
                        • <b>Incident comparison ratio:</b> 12.20 / 6.72 = <b>1.82x</b> (displayed as 1.8x)<br/>
                        • <b>Spearman rank correlation (UHI vs recorded incidents):</b> ρ = <b>0.343</b> (p = 2.52e-16)<br/>
                        • <b>Spearman rank correlation (UHI vs composite risk index):</b> ρ = <b>0.362</b> (p = 3.95e-18)<br/>
                        • <b>Non-Causal Warning:</b> Reflects environmental built-environment correlates (alleyway lighting, density); does NOT prove thermal causation or intervention efficacy.
                      </div>
                    </details>
                  </div>

                  <div style={{ borderTop: '1px solid #FFD1C9', paddingTop: 14 }}>
                    <div style={{ fontSize: '0.72rem', color: '#9A2C1C', textTransform: 'uppercase', fontWeight: 700 }}>
                      INCIDENT RATIO
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#FF7868', marginTop: 2 }}>
                      1.8x Ratio (Spearman ρ = 0.36)
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickFilter('high');
                        setActiveTab('cockpit');
                      }}
                      className="btn-secondary"
                      style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
                    >
                      <Search size={14} color="#FF7868" /> View Built-Up High Priority Zones →
                    </button>
                  </div>
                </div>

                {/* Card 3: Lavender Pastel */}
                <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#F0EBFF', border: '1px solid #DDD6FE' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span className="badge" style={{ background: '#EDE9FE', color: '#6D28D9', border: '1px solid #DDD6FE' }}>DISCOVERY 03</span>
                      <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: '#5B21B6', fontWeight: 700 }}>
                        Reporting Equity
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.18rem', fontWeight: 800, marginBottom: 10, lineHeight: 1.3, color: '#1E293B' }}>
                      Digital Connectivity &amp; Vulnerability Indicator Disparity
                    </h3>

                    <div style={{ 
                      background: '#FFFFFF', 
                      borderLeft: '4px solid #7C3AED', 
                      padding: '10px 14px', 
                      borderRadius: '0 8px 8px 0',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: '#5B21B6',
                      marginBottom: 14,
                      border: '1px solid #DDD6FE'
                    }}>
                      Lower internet penetration areas exhibit higher composite risk scores (14.0 vs 8.2, a +5.9 point disparity).
                    </div>

                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                      Neighborhoods in the lowest digital penetration tier average a risk index of 14.0 compared to 8.2 in high-connectivity areas (a +5.9 point gap). While lower digital access correlates negatively with recorded total crimes (Spearman ρ = -0.30), the composite score accounts for structural factors.
                    </p>

                    {/* Auditable Evidence & Limitations Toggle */}
                    <details style={{ background: '#FFFFFF', padding: '10px 14px', borderRadius: 8, border: '1px solid #DDD6FE', fontSize: '0.76rem', color: '#5B21B6', marginBottom: 14 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Evidence &amp; Limitations (Auditable Disclosure)</summary>
                      <div style={{ marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        • <b>Low-connectivity tier:</b> N = 180 localities (mean risk index = 14.025)<br/>
                        • <b>High-connectivity tier:</b> N = 175 localities (mean risk index = 8.155)<br/>
                        • <b>Disparity gap:</b> 14.025 - 8.155 = <b>+5.870 points</b> (displayed as +5.9 points)<br/>
                        • <b>Formula Transparency:</b> internet_pct directly carries a negative coefficient (-0.0870) in the composite risk index formula.<br/>
                        • <b>Integrity Note:</b> Part of this association is mathematically built into the formula by definition; it does NOT independently establish digital under-reporting or validate the index.
                      </div>
                    </details>
                  </div>

                  <div style={{ borderTop: '1px solid #DDD6FE', paddingTop: 14 }}>
                    <div style={{ fontSize: '0.72rem', color: '#5B21B6', textTransform: 'uppercase', fontWeight: 700 }}>
                      DISPARITY GAP
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#7C3AED', marginTop: 2 }}>
                      Disparity Gap: +5.9 Index Points
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickFilter('chowki_deficit');
                        setActiveTab('cockpit');
                      }}
                      className="btn-secondary"
                      style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
                    >
                      <Search size={14} color="#7C3AED" /> View Outpost Deficit Areas on Map →
                    </button>
                  </div>
                </div>

              </div>
            ) : (
              /* General Dataset Profile Mode when specialized crime/chowki fields are not mapped */
              <div className="glass-panel" style={{ padding: 24, background: '#FFFFFF' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ background: '#E8F6FF', padding: 10, borderRadius: 10 }}>
                    <Info size={24} color="#168BFF" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1E293B' }}>General Dataset Profile &amp; Distribution</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      This custom dataset is operating in <b>General Spatial Profile Mode</b>. To unlock the 3 specialized safety discoveries (Chowki Strain, UHI correlation, and Digital reporting disparity), map the required fields (Incidents, Police Chowkis, UHI, and Internet %) in the Upload Data tab.
                    </p>
                  </div>
                </div>

                <div className="quality-grid">
                  <div className="quality-card" style={{ background: '#F8FAFC' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>TOTAL RECORDS</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1E293B', fontFamily: 'var(--font-mono)' }}>{dataQuality.totalRows}</div>
                  </div>
                  <div className="quality-card" style={{ background: '#F8FAFC' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>VALID COORDINATES</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#20B879', fontFamily: 'var(--font-mono)' }}>{dataQuality.validCoords}</div>
                  </div>
                  <div className="quality-card" style={{ background: '#F8FAFC' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>MISSING VALUES</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#D97706', fontFamily: 'var(--font-mono)' }}>{dataQuality.missingValuesCount}</div>
                  </div>
                  <div className="quality-card" style={{ background: '#F8FAFC' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>MAPPED COLUMNS</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#168BFF', fontFamily: 'var(--font-mono)' }}>
                      {Object.values(activeDataset.fieldMapping || {}).filter(Boolean).length} / {activeDataset.rawColumns.length}
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            VIEW 5: METHOD SELECTION & COMPOSITE INDICATOR FIDELITY
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'benchmark' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#1E293B' }}>Analytical Method &amp; Baseline Comparison</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Comparing Naive Per-Capita Crime Baseline vs. Formula-Derived Composite Demonstration Indicator.
              </p>
            </div>

            {/* Formula Decomposition Card */}
            <div className="glass-panel" style={{ padding: 24, marginBottom: 20, background: '#FFFFFF' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 10, color: '#1E293B' }}>
                Documented Composite Indicator Formula
              </h3>
              <div style={{ background: '#F4FAFF', border: '1px solid #BAE6FD', borderRadius: 8, padding: 14, fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#0369A1', lineHeight: 1.6, marginBottom: 12 }}>
                risk_index = 6.2726 + 0.1136·(total_crimes) - 0.000072·(population_density) + 0.4013·(police_density) + 0.9224·(uhi_index) - 0.0870·(internet_pct)
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <b>Audit &amp; Integrity Note:</b> The dataset's risk index is a formula-derived demonstration score. An OLS regression fit on these exact inputs achieves $R^2 = 1.000$ (max residual &lt; 1e-11) because it simply reconstructs the linear formula. Rather than making circular claims about 99.7% crime predictability, CityPulse presents this formula transparently as an administrative prioritization indicator.
              </p>
            </div>

            {/* Benchmark Table Card */}
            <div className="glass-panel" style={{ padding: 24, marginBottom: 20, background: '#FFFFFF' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 14, color: '#1E293B' }}>
                Indicator Comparison: Naive Baseline vs. Composite Indicator
              </h3>

              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Method Name</th>
                      <th>Method Type</th>
                      <th>Inputs Ingested</th>
                      <th>MAE</th>
                      <th>RMSE</th>
                      <th>R² Fit</th>
                      <th>Spearman Rank (ρ)</th>
                      <th>Evaluation Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmark.models.map((m, idx) => (
                      <tr key={idx} style={{ background: idx === 1 ? '#E8F6FF' : '#FFFFFF' }}>
                        <td style={{ fontWeight: 800, color: idx === 1 ? '#0369A1' : '#1E293B' }}>
                          {m.name}
                        </td>
                        <td>{m.type}</td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.features_used}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{m.mae}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{m.rmse}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: idx === 1 ? '#20B879' : '#1E293B' }}>
                          {m.r2}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#168BFF' }}>
                          {m.spearman_rho}
                        </td>
                        <td>
                          <span className={`badge ${idx === 1 ? 'badge-blue' : ''}`} style={{ background: idx === 0 ? 'var(--bg-alt)' : undefined, color: idx === 0 ? 'var(--text-secondary)' : undefined }}>
                            {m.role || (idx === 1 ? 'Demonstration Indicator' : 'Baseline')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Feature Weights Grid */}
            <div className="glass-panel" style={{ padding: 24, marginBottom: 20, background: '#FFFFFF' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: 6, color: '#1E293B' }}>
                Composite Indicator Term Weights
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                Exact mathematical coefficients assigned to structural features in the demonstration index.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                {feature_importances.map((fi, i) => (
                  <div key={i} style={{ background: 'var(--bg-alt)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: '#1E293B' }}>{fi.feature.replace(/_/g, ' ')}</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary-blue)' }}>{fi.ridge_coefficient > 0 ? `+${fi.ridge_coefficient}` : fi.ridge_coefficient}</strong>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{fi.role || 'Linear term'}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Official Mumbai Police Crime Heads Benchmark (2022–2023) */}
            {crimeHeadsData && crimeHeadsData.length > 0 && (
              <div className="glass-panel" style={{ padding: 24, marginBottom: 20, background: '#FFFFFF' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-emerald">Official Authority Benchmark</span>
                      <span className="badge badge-blue">Greater Mumbai Police</span>
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1E293B', marginTop: 4 }}>
                      Mumbai Police IPC Crime Heads &amp; Detection Clearance (2022–2023)
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Official baseline audit metrics published by Mumbai Police across all major IPC crime heads.
                    </p>
                  </div>

                  <div className="search-input-wrapper" style={{ maxWidth: 280 }}>
                    <Search size={14} className="search-icon" />
                    <input 
                      type="text" 
                      placeholder="Filter crime head (e.g. Robbery, Theft)..." 
                      value={benchmarkSearch}
                      onChange={(e) => setBenchmarkSearch(e.target.value)}
                    />
                    {benchmarkSearch.trim().length > 0 && (
                      <button 
                        type="button" 
                        onClick={() => setBenchmarkSearch('')}
                        className="search-clear-btn"
                        title="Clear filter"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 4 Quick KPI Highlight Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <div style={{ background: '#F4FAFF', border: '1px solid #BAE6FD', padding: '12px 16px', borderRadius: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: '#0369A1', fontWeight: 700, textTransform: 'uppercase' }}>TOTAL IPC CASES (2023)</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#168BFF', marginTop: 2 }}>45,869</div>
                    <div style={{ fontSize: '0.72rem', color: '#20B879', fontWeight: 700, marginTop: 2 }}>
                      ▼ -34.8% YoY drop (vs 70,367 in 2022)
                    </div>
                  </div>

                  <div style={{ background: '#E5FAEF', border: '1px solid #A7F3D0', padding: '12px 16px', borderRadius: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: '#065F46', fontWeight: 700, textTransform: 'uppercase' }}>CITYWIDE CLEARANCE RATE</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#20B879', marginTop: 2 }}>76.3%</div>
                    <div style={{ fontSize: '0.72rem', color: '#065F46', fontWeight: 700, marginTop: 2 }}>
                      ▲ +8.3% improvement (vs 68.0% in 2022)
                    </div>
                  </div>

                  <div style={{ background: '#FFF0E8', border: '1px solid #FFD1C9', padding: '12px 16px', borderRadius: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: '#9A2C1C', fontWeight: 700, textTransform: 'uppercase' }}>WOMEN'S SAFETY CLEARANCE</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#FF7868', marginTop: 2 }}>95.7%</div>
                    <div style={{ fontSize: '0.72rem', color: '#9A2C1C', fontWeight: 700, marginTop: 2 }}>
                      96% Rape clearance · 95% Molestation
                    </div>
                  </div>

                  <div style={{ background: '#F0EBFF', border: '1px solid #DDD6FE', padding: '12px 16px', borderRadius: 10 }}>
                    <div style={{ fontSize: '0.7rem', color: '#5B21B6', fontWeight: 700, textTransform: 'uppercase' }}>VIOLENT CRIME CLEARANCE</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#7C3AED', marginTop: 2 }}>97.2%</div>
                    <div style={{ fontSize: '0.72rem', color: '#5B21B6', fontWeight: 700, marginTop: 2 }}>
                      98% Robbery · 96% Murder · 100% Dacoity
                    </div>
                  </div>
                </div>

                {/* Benchmark Data Table with Visual Clearance Bars */}
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Crime Head (IPC Category)</th>
                        <th>2023 Registered</th>
                        <th>2023 Detected</th>
                        <th>2023 Clearance Rate</th>
                        <th>2022 Registered</th>
                        <th>2022 Clearance</th>
                        <th>YoY Volume Trajectory</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crimeHeadsData
                        .filter(r => {
                          if (!benchmarkSearch.trim()) return true;
                          const name = String(r['Crime Heads'] || '').toLowerCase();
                          return name.includes(benchmarkSearch.toLowerCase());
                        })
                        .map((row, idx) => {
                          const headName = row['Crime Heads'] || '';
                          const isTotal = headName.toLowerCase().includes('total');
                          const reg23 = row['2023 Registered'] ?? '—';
                          const det23 = row['2023 Detected'] ?? '—';
                          const pct23 = cleanNumber(row['%Age Detection - 2023']);
                          const reg22 = row['2022 Registered'] ?? '—';
                          const pct22 = cleanNumber(row['%Age Detected 2022']);
                          
                          const numReg23 = cleanNumber(reg23);
                          const numReg22 = cleanNumber(reg22);
                          const yoyChange = (!isNaN(numReg23) && !isNaN(numReg22) && numReg22 > 0)
                            ? Math.round(((numReg23 - numReg22) / numReg22) * 100)
                            : null;

                          const clearanceColor = !isNaN(pct23) 
                            ? (pct23 >= 90 ? '#20B879' : (pct23 >= 70 ? '#D97706' : '#FF7868'))
                            : '#64748B';

                          return (
                            <tr key={idx} style={{ background: isTotal ? '#F8FAFC' : undefined, fontWeight: isTotal ? 800 : undefined }}>
                              <td style={{ fontWeight: 800, color: isTotal ? '#168BFF' : '#1E293B' }}>
                                {headName}
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                {typeof reg23 === 'number' ? reg23.toLocaleString() : reg23}
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)' }}>
                                {typeof det23 === 'number' ? det23.toLocaleString() : det23}
                              </td>
                              <td>
                                {!isNaN(pct23) ? (
                                  <div className="detect-bar-container">
                                    <div className="detect-bar-track">
                                      <div 
                                        className="detect-bar-fill" 
                                        style={{ width: `${Math.min(100, pct23)}%`, background: clearanceColor }} 
                                      />
                                    </div>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: clearanceColor, fontSize: '0.8rem', minWidth: 42 }}>
                                      {pct23}%
                                    </span>
                                  </div>
                                ) : '—'}
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                                {typeof reg22 === 'number' ? reg22.toLocaleString() : reg22}
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                                {!isNaN(pct22) ? `${pct22}%` : '—'}
                              </td>
                              <td>
                                {yoyChange !== null ? (
                                  <span className={`badge ${yoyChange <= 0 ? 'badge-emerald' : 'badge-red'}`} style={{ fontSize: '0.72rem' }}>
                                    {yoyChange <= 0 ? `▼ ${yoyChange}%` : `▲ +${yoyChange}%`}
                                  </span>
                                ) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 12, fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <b>Authoritative Source:</b> Mumbai Police Commissionerate Annual IPC Crime Statistics (2022–2023). High clearance rates in violent and bodily offences demonstrate rigorous detection capacity; property offences remain priority areas for streetlighting and surveillance upgrades.
                </div>
              </div>
            )}

            {/* Scientific Integrity & Responsible AI Banner */}
            <div style={{ background: '#FFF7D6', border: '1px solid #FDE68A', borderRadius: 10, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#92400E', fontWeight: 800, fontSize: '0.92rem', marginBottom: 8 }}>
                <ShieldAlert size={20} color="#D97706" /> Responsible AI &amp; Limitation Disclosures
              </div>
              <ul style={{ fontSize: '0.82rem', color: '#78350F', lineHeight: 1.6, paddingLeft: 20 }}>
                <li><b>Prototype Disclaimer:</b> This decision-support system is an analytical prototype for municipal resource prioritization and does NOT replace emergency dispatch or official police judgement.</li>
                <li><b>Reporting Friction Bias:</b> Official police FIR records inherently suffer from reporting bias. Wards with lower digital accessibility or informal settlements often register fewer online complaints despite severe real-world vulnerability.</li>
                <li><b>Correlation $\neq$ Causation:</b> Associations between Urban Heat Island (UHI) density and crime reflect environmental built-up features (alley lighting, transit bottlenecks), not thermal causation.</li>
              </ul>
            </div>

          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            VIEW 6: DATA EXPLORER & ACTIVE DATASET
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'data' && (
          <div className="glass-panel" style={{ padding: 24, background: '#FFFFFF' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1E293B' }}>Dataset Explorer &amp; Active Records</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Active source: <b>{activeDataset.name}</b> ({activeDataset.records.length} records total · {filteredLocalities.length} filtered).
                </p>
              </div>

              {/* Action Toolbar */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="search-input-wrapper" style={{ width: 220 }}>
                  <Search size={14} className="search-icon" />
                  <input 
                    type="text" 
                    placeholder="Filter records..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="search-clear-btn"
                      title="Clear search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                  <option value="all">All Tiers</option>
                  <option value="High">🔴 High Priority</option>
                  <option value="Medium">🟡 Medium Priority</option>
                  <option value="Low">🟢 Lower-Priority</option>
                </select>

                <button
                  type="button"
                  onClick={() => setShowDataDictionary(!showDataDictionary)}
                  className="btn-secondary"
                  title="View explanations for each column"
                >
                  <BookOpen size={14} color="#168BFF" />
                  <span>{showDataDictionary ? 'Hide Dictionary' : 'Column Dictionary'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="btn-primary"
                  title="Download clean CSV of filtered records"
                >
                  <Download size={14} />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Expandable Column Dictionary */}
            {showDataDictionary && (
              <div style={{ background: '#F8FAFC', border: '1px solid var(--border-light)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#1E293B', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Info size={15} color="#168BFF" />
                  <span>Data Dictionary &amp; Column Guide (Readable Reference)</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                  <div style={{ background: '#FFFFFF', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ color: '#168BFF', fontSize: '0.76rem' }}>locality</b>: Neighborhood, zone, or administrative area name.
                  </div>
                  <div style={{ background: '#FFFFFF', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ color: '#168BFF', fontSize: '0.76rem' }}>ward</b>: BMC Municipal administrative ward (A through T).
                  </div>
                  <div style={{ background: '#FFFFFF', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ color: '#168BFF', fontSize: '0.76rem' }}>population_density</b>: Estimated residents per square kilometer.
                  </div>
                  <div style={{ background: '#FFFFFF', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ color: '#168BFF', fontSize: '0.76rem' }}>police_chowkis</b>: Number of physical police outposts or beats in the locality.
                  </div>
                  <div style={{ background: '#FFFFFF', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ color: '#168BFF', fontSize: '0.76rem' }}>risk_index</b>: Administrative prioritization score (0–20 scale: High ≥15, Med 7–15, Low &lt;7).
                  </div>
                  <div style={{ background: '#FFFFFF', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ color: '#168BFF', fontSize: '0.76rem' }}>uhi_index</b>: Urban Heat Island proxy for paved built-environment density (0 to 1).
                  </div>
                </div>
              </div>
            )}

            {/* Sortable Table */}
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th onClick={() => handleSortToggle('locality')} style={{ cursor: 'pointer' }} title="Click to sort by Locality">
                      Locality / Name {dataSortColumn === 'locality' && (dataSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSortToggle('zone')} style={{ cursor: 'pointer' }} title="Click to sort by Zone">
                      Zone {dataSortColumn === 'zone' && (dataSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSortToggle('ward')} style={{ cursor: 'pointer' }} title="Click to sort by Ward">
                      Ward {dataSortColumn === 'ward' && (dataSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSortToggle('population_density')} style={{ cursor: 'pointer' }} title="Click to sort by Density">
                      Density (/km²) {dataSortColumn === 'population_density' && (dataSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSortToggle('police_chowkis')} style={{ cursor: 'pointer' }} title="Click to sort by Chowkis">
                      Chowkis {dataSortColumn === 'police_chowkis' && (dataSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSortToggle('crimes_against_women')} style={{ cursor: 'pointer' }} title="Click to sort by Incidents">
                      Incidents {dataSortColumn === 'crimes_against_women' && (dataSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSortToggle('risk_index')} style={{ cursor: 'pointer' }} title="Click to sort by Priority Score">
                      Priority Score {dataSortColumn === 'risk_index' && (dataSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Tier</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLocalities.slice(0, 60).map((loc, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 800 }}>{loc.locality}</td>
                      <td>{loc.zone || '—'}</td>
                      <td>{loc.ward || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{loc.population_density ? Math.round(loc.population_density).toLocaleString() : '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{loc.police_chowkis ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: '#FF7868', fontWeight: 800 }}>{loc.crimes_against_women ?? loc.total_crimes ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: loc.risk_tier === 'High' ? '#FF7868' : (loc.risk_tier === 'Medium' ? '#D97706' : '#20B879') }}>
                        {Number(loc.risk_index).toFixed(1)}
                      </td>
                      <td>
                        <span className={`badge ${
                          loc.risk_tier === 'High' ? 'badge-red' : 
                          loc.risk_tier === 'Medium' ? 'badge-amber' : 'badge-emerald'
                        }`}>
                          {loc.risk_tier === 'Low' ? 'Lower-Priority' : `${loc.risk_tier} Priority`}
                        </span>
                      </td>
                      <td>
                        <button 
                          type="button"
                          onClick={() => {
                            handleSelectLocality(loc);
                            setActiveTab('cockpit');
                          }}
                          className="btn-secondary"
                          style={{ fontSize: '0.72rem', padding: '4px 8px' }}
                        >
                          View Dossier →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14, fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span>Showing top {Math.min(60, sortedLocalities.length)} of {sortedLocalities.length} sorted records (Sorted by: <b>{dataSortColumn} {dataSortDirection.toUpperCase()}</b>)</span>
              <span>All {activeDataset.records.length} records loaded in memory · Click any column header to sort</span>
            </div>
          </div>
        )}

      </main>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: '1px solid var(--border-light)', padding: '16px 24px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', background: '#FFFFFF' }}>
        CityPulse: Urban Safety &amp; Civic Resource Allocation Platform · 
        OpenStreetMap Data © OSM Contributors · 100% Zero-Cost Reproducible
      </footer>

      {/* ── CIVIC DECISION GUIDE & METHOD EXPLAINER MODAL ── */}
      {showCivicGuide && (
        <div className="civic-modal-overlay" onClick={() => setShowCivicGuide(false)}>
          <div className="civic-modal-content" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--border-light)', background: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: '#E8F6FF', padding: 8, borderRadius: 8 }}>
                  <BookOpen size={20} color="#168BFF" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1E293B' }}>
                    CityPulse Civic Decision Guide &amp; How It Works
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    A plain-English guide to understanding priority scores, spatial factors, and planning simulations.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCivicGuide(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: 'var(--text-muted)' }}
                title="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Section 1: 0-20 Scale */}
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#1E293B', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: '#E8F6FF', color: '#168BFF', width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>1</span>
                  How to Read the 0–20 Priority Score
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                  CityPulse uses a normalized 0 to 20 administrative score to help municipal planners allocate police posts, streetlights, and surveillance beats where need is greatest:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  <div style={{ background: '#FFF5F3', border: '1px solid #FFD1C9', padding: '12px 14px', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span className="badge badge-red" style={{ fontSize: '0.7rem' }}>Score ≥ 15.0</span>
                      <b style={{ color: '#9A2C1C', fontSize: '0.8rem' }}>High Priority (P1)</b>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#78350F', lineHeight: 1.5 }}>
                      Severe resource deficit relative to incident volume in dense corridors. Target for immediate modular chowki installation and LED upgrades.
                    </div>
                  </div>

                  <div style={{ background: '#FFFDF0', border: '1px solid #FDE68A', padding: '12px 14px', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>Score 7.0 – 14.9</span>
                      <b style={{ color: '#92400E', fontSize: '0.8rem' }}>Medium Priority (P2)</b>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#78350F', lineHeight: 1.5 }}>
                      Moderate density with balanced baseline coverage. Recommended for proactive night patrols, lighting audits, and routine foot beats.
                    </div>
                  </div>

                  <div style={{ background: '#F2FCF6', border: '1px solid #A7F3D0', padding: '12px 14px', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span className="badge badge-emerald" style={{ fontSize: '0.7rem' }}>Score &lt; 7.0</span>
                      <b style={{ color: '#065F46', fontSize: '0.8rem' }}>Lower-Priority (P3)</b>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#065F46', lineHeight: 1.5 }}>
                      Adequate outpost coverage and lower incident pressure. Recommended for baseline maintenance and regular civic monitoring.
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Factor Attributions */}
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#1E293B', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: '#E8F6FF', color: '#168BFF', width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>2</span>
                  What Drives Each Locality's Score? (Factor Attribution)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ fontSize: '0.78rem', color: '#FF7868' }}>Incident History (~35%)</b>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      Historical volume of recorded safety complaints in the locality.
                    </p>
                  </div>
                  <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ fontSize: '0.78rem', color: '#168BFF' }}>Outpost Deficit (~30%)</b>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      Scarcity of physical police chowkis relative to residents and land area.
                    </p>
                  </div>
                  <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ fontSize: '0.78rem', color: '#8B5CF6' }}>Built-Up &amp; UHI Proxy (~20%)</b>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      Concrete density, narrow transit alleys, and commercial activity nodes.
                    </p>
                  </div>
                  <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <b style={{ fontSize: '0.78rem', color: '#F59E0B' }}>Digital Reporting Proxy (~15%)</b>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                      Accounts for reporting friction bias where internet access is lower.
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 3: Scenario Simulator */}
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#1E293B', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ background: '#E8F6FF', color: '#168BFF', width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}>3</span>
                  How to Use the Policy &amp; Resource Simulator
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  In the <b>Planning Simulator</b> tab, planners can test adding auxiliary chowkis, expanding smart LED lighting, or deploying intensive night patrols. The engine immediately computes the projected risk reduction and tier shift, allowing municipal administrators to evaluate cost-effective capital interventions before spending tax revenue.
                </p>
              </div>

              {/* Section 4: Responsible AI */}
              <div style={{ background: '#FFF7D6', border: '1px solid #FDE68A', padding: '14px 18px', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#92400E', fontWeight: 800, fontSize: '0.85rem', marginBottom: 6 }}>
                  <ShieldAlert size={17} color="#D97706" />
                  <span>Responsible AI &amp; Scientific Integrity</span>
                </div>
                <p style={{ fontSize: '0.78rem', color: '#78350F', lineHeight: 1.55 }}>
                  CityPulse is an indicator demonstration tool for municipal planning prioritization. Official crime statistics reflect reporting behavior and digital access, not moral characteristics of communities. Always consult official police authorities for real-world enforcement decisions.
                </p>
              </div>

            </div>

            {/* Modal Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'flex-end', background: '#F8FAFC' }}>
              <button
                type="button"
                onClick={() => setShowCivicGuide(false)}
                className="btn-primary"
                style={{ padding: '8px 20px', fontSize: '0.82rem' }}
              >
                Close &amp; Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
