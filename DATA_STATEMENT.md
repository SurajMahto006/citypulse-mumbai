# CityPulse Mumbai: Data Statement & Provenance Specification

**Repository:** `citypulse-mumbai` (`https://github.com/SurajMahto006/citypulse-mumbai.git`)  
**Project Category:** Civic Technology, Urban Analytics, and Data Science  
**Description:** A data-driven urban safety and city intelligence platform for exploring locality-level indicators, visualizing geographic patterns, and evaluating hypothetical infrastructure-planning scenarios.  
**Document Version:** 2.3 (General Urban Safety & City Intelligence Aligned)  

---

## 1. Dataset Overview & Provenance Classification

- **Dataset Title:** Greater Mumbai Locality-Level Urban Safety, Infrastructure & Demographics Demonstration Dataset
- **Canonical Dataset File:** `mumbai_urban_safety.csv` ($N = 538$ observation records)
- **Geographic Extent:** Greater Mumbai (Island City, Western Suburbs, Eastern Suburbs)
  - Latitude: 18.89°N to 19.28°N
  - Longitude: 72.78°E to 72.98°E
- **Temporal Scope:** Consolidated municipal administrative snapshot and OpenStreetMap live infrastructure pulls.
- **Access & Reproducibility:** 100% public, open data with zero-cost OpenStreetMap (Overpass API) geometries and CARTO Positron light raster tiles (with standard OSM fallback to guarantee zero "API KEY REQUIRED" watermark). Zero paid API keys.

### 1.1 Critical Classification: Traceable Facts vs. Demonstration Data
To uphold complete scientific integrity:

1. **Documented & Traceable Geospatial Entities:**
   - **Police Stations & Outposts:** Traceable to OpenStreetMap live infrastructure queries (`amenity=police`).
   - **Administrative Zones:** Macro-zone assignments (Island City, Western Suburbs, Eastern Suburbs) correspond to authentic Greater Mumbai geography.
2. **Compilation / Demonstration Data:**
   - **Observation Unit Heterogeneity:** The 538 records mix street segments (e.g., *Aloysius Soares Road*, *Dr. M.B. Velkar Street*), neighborhoods (*Bandra*, *Kurla*), and municipal wards (*"L" Ward*).
   - **Crime & Population Granularity:** Official Indian authorities (National Crime Records Bureau, Mumbai Police, MCGM) publish official crime and census records at ward or police station jurisdiction levels, not at individual street-segment levels. Consequently, the street-level crime counts and population figures in this dataset function as an open research and prototype compilation designed for municipal spatial decision-support demonstration.
   - **Target Variable (`risk_index`):** As proven through OLS decomposition, `risk_index` is a deterministic, formula-derived composite indicator. It is an existing multi-criteria priority scale (0–30), not an independently validated empirical measure of real-world crime outcomes.

### 1.2 Geographic Approximation & Spatial Anchoring Heuristic (Audit Disclosure)
During our code audit of `data_pipeline.py` (lines 100–188), we traced the exact mechanism by which coordinates are assigned:
- **56 Major Anchor Localities:** Have verified, authentic Mumbai centroid coordinates and BMC ward assignments defined in `WARD_ANCHORS` (e.g., *Andheri*, *Bandra*, *Kurla*, *Dadar*, *Colaba*, *Chembur*).
- **482 Remaining Observation Units:** Do not possess individual street-level GIS survey coordinates in the source file. Their coordinates are generated through **deterministic MD5 hash-based spatial jitter** around three macro-zone centroids:
  - *Western Suburbs Axis:* Centered at $(19.1200, 72.8450)$, Ward K/W
  - *Eastern Suburbs Axis:* Centered at $(19.0800, 72.9000)$, Ward L
  - *Island City Axis:* Centered at $(18.9800, 72.8300)$, Ward G/S
- **Audit Mandate:** These 482 positions are heuristic spatial placements for prototype visualization, NOT verified cadastral survey points. The 538 records must **never** be presented as an official street-level census or authoritative police crime map.

### 1.3 Scope & Dataset Limitation Disclosure
While CityPulse Mumbai is designed as a city-wide intelligence and urban safety platform for all citizens, residents, commuters, and municipal planners, the current benchmark dataset includes locality indicators where reported vulnerable incident counts are specifically sourced from recorded crimes against women. As municipal data pipelines expand, the platform is designed to ingest general IPC crime, pedestrian hazard, and civic vulnerability metrics via the built-in CSV/JSON/GeoJSON schema mapper.

### 1.4 Undocumented Provenance in Source Data
In strict accordance with Hackathon Section 13 standards, we report the following unverified source details:
- **Missing Temporal Metadata:** The underlying open research repository does not specify the exact calendar year of collection, individual FIR logging timestamps, or whether crime tallies represent a 12-month or multi-year aggregate.
- **Undocumented Street Compilation Authority:** No official government gazette or agency citation accompanies the street-by-street population estimates. They are treated strictly as demonstration compilation figures.

---

## 2. Source Provenance & Licensing

| Component | Source Portal / Authority | License / Access Terms | Status & Verification |
| :--- | :--- | :--- | :--- |
| **Locality Demographics & Incident Compilation** | Municipal/research compilation (`mumbai_urban_safety.csv`) adapted from open Mumbai safety research repository. | Open Public Research License | Traceable compilation; demonstration units. Undocumented collection dates. |
| **Police Station Geometries** | OpenStreetMap (OSM) via Overpass API (`amenity=police`). | Open Database License (ODbL) © OpenStreetMap contributors | Verified live geometries; zero paid keys. |
| **Geocoding & Centroids** | 56 verified anchors via OSM Nominatim; 482 positioned via deterministic hash jitter. | ODbL / Open Heuristic | Heuristic spatial placement. |
| **Basemap Tiles** | CARTO Positron light raster tiles with authenticated key / OSM standard fallback. | © OpenStreetMap contributors, © CARTO | Zero-cost, watermark-free raster endpoint. |

---

## 3. Data Dictionary & Schema

The curated dataset contains 538 rows and 22 curated attributes:

| Variable Name | Data Type | Units / Range | Definition & Context |
| :--- | :--- | :--- | :--- |
| `locality` | String | Categorical | Locality name in Mumbai (street, neighborhood, or ward level). |
| `zone` | String | Categorical | Macro-administrative zone: *Island City*, *Western Suburbs*, or *Eastern Suburbs*. |
| `ward` | String | Categorical | Brihanmumbai Municipal Corporation (BMC) administrative ward. |
| `lat`, `lon` | Float | Decimal Degrees | Geographic coordinates (56 verified anchors, 482 heuristic jittered positions). |
| `population` | Integer | $5,600 - 32,000$ | Resident population figure in demonstration record. |
| `area_sq_km` | Float | $0.35 - 1.25\ \text{km}^2$ | Locality spatial footprint. |
| `population_density` | Float | $4,800 - 62,000\ /\text{km}^2$ | Resident density per square kilometer. |
| `uhi_index` | Float | $0.40 - 0.95$ | Urban Heat Island Index (proxy for built-up density, thermal mass, and lack of canopy). |
| `uhi_category` | String | High, Medium, Low | Categorical binning of built-up thermal density ($N=148$ High, $N=192$ Medium, $N=198$ Low). |
| `police_chowkis` | Integer | $1 - 7$ | Operational police outposts / chowkis within the locality boundaries. |
| `police_density` | Float | $0.8 - 14.0\ /\text{km}^2$ | Police outposts per square kilometer. |
| `internet_pct` | Float | $82\% - 96\%$ | Estimated digital connectivity percentage (carries a $-0.0870$ coefficient in formula). |
| `total_crimes` | Integer | $30 - 170$ | Total recorded criminal infractions in annual window. |
| `crimes_against_women`| Integer | $3 - 22$ | Recorded FIRs involving offenses against women; used as the vulnerable safety indicator in the benchmark formula. |
| `chowki_deficit_ratio` | Float | $1,200 - 45,000$ | Operational strain ratio: $\frac{\text{population\_density}}{\text{police\_density} + 0.1}$. |
| `risk_index` | Float | $2.5 - 26.5$ | Deterministic multi-criteria safety vulnerability index (0–30 scale). |
| `risk_tier` | String | High, Medium, Low | Operational triage tier: **High** ($\ge 15.0$), **Medium** ($7.0 - 14.9$), **Lower-Priority / Maintenance** ($< 7.0$). |
| `baseline_pred` | Float | $2.0 - 25.0$ | Scaled prediction from the Naive Per-Capita Crime Baseline ($\text{incidents}/\text{pop} \times 10,000$). |
| `formula_pred` | Float | $2.5 - 26.5$ | Exact analytical value computed from the decomposed formula. |
| `ci_lower`, `ci_upper` | Float | $1.8 - 27.2$ | Analytical 95% Confidence Interval error bounds ($\pm 0.70$ margin of error). |

---

## 4. Priority Tier Definitions & Categorization Thresholds

The priority tiers divide the 0–30 multi-criteria indicator into actionable municipal operational bands:
- **High Priority ($\ge 15.0$, $N = 137$, $25.5\%$):** Represents approximately the top quartile of highest-strain localities. Designated for P1 municipal fast-tracking (auxiliary chowki proposals, dedicated night-beat scheduling, LED smart lighting).
- **Medium Priority ($7.0 - 14.9$, $N = 202$, $37.5\%$):** Represents moderate vulnerability requiring P2 proactive evening foot patrols (18:00–22:00) and tree-canopy trimming.
- **Lower-Priority Areas / Baseline Maintenance ($< 7.0$, $N = 199$, $37.0\%$):** Represents baseline coverage where standard patrol intervals are maintained.
- **Non-Guarantee Disclaimer:** Labeling an area "Lower-Priority" reflects relative municipal resource triage under this specific multi-criteria formula. It does **not** constitute a forensic guarantee of safety.

---

## 5. Potential Biases, Exclusions & Limitations

1. **FIR Reporting Friction Bias:** Official crime statistics represent *recorded* FIRs. Localities with lower digital connectivity ($<87\%$) and higher informal settlement density historically face acute reporting friction. CityPulse counteracts raw complaint bias by incorporating structural infrastructure deficits into its priority formula.
2. **Formula-Built Digital Association:** Because `internet_pct` enters the composite index formula with a negative weight ($-0.0870$), part of the observed negative association between internet access and risk index is structural by construction. It must not be cited as independent empirical validation of under-reporting.
3. **Exclusion of Cyber / Payment Safety Data:** Payment fraud and cyber crime datasets were explicitly excluded from this physical street-safety prioritization system, as digital transaction fraud requires distinct institutional countermeasures (cyber cells, banking freeze protocols) unrelated to municipal street lighting or police beat scheduling.
4. **Non-Causal Interpretation:** Associations between environmental indicators (such as UHI index) and crime rates reflect spatial correlates (e.g., lack of open space, narrow unlit alleys, informal built-up corridors), not direct thermal causation.
5. **Planning Prototype Status:** The system is an administrative decision-support prototype. It does not replace real-time police emergency dispatch (100/112).
6. **Broader Product Vision vs. Current Dataset Scope:** While CityPulse is designed for the entire public and broad urban safety intelligence, the current benchmark dataset represents a specific research compilation focusing on structural infrastructure and vulnerable safety indicators. The platform's dynamic schema mapper is engineered to ingest broader municipal datasets (pedestrian safety, lighting surveys, traffic hazard logs) seamlessly.
