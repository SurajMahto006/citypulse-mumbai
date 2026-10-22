# CityPulse Mumbai: Predict. Explain. Act.
## Official Problem Statement Knowledge Base & Strategic Guardrails
**Repository:** `citypulse-mumbai` (`https://github.com/SurajMahto006/citypulse-mumbai.git`)  
**Project Category:** Civic Technology, Urban Analytics, and Data Science  
**Description:** A data-driven urban safety and city intelligence platform for exploring locality-level indicators, visualizing geographic patterns, and evaluating hypothetical infrastructure-planning scenarios.  
**Track:** Urban Computing & AI Decision Support  

---

## 1. Executive Summary & Core Mandate

### 1.1 The Challenge Philosophy
**CityPulse** requires teams to build a data-driven, evidence-backed decision-support prototype that uses public urban data to address real-world city challenges. The overarching paradigm is:

$$\mathbf{DISCOVER} \longrightarrow \mathbf{PREDICT\ (IF\ FEASIBLE)} \longrightarrow \mathbf{EXPLAIN} \longrightarrow \mathbf{ACT}$$

### 1.2 The Golden Rule
> **"A trustworthy, useful decision-support product is far more important than an unnecessarily complicated model."**

- **Do NOT assume forecasting is mandatory:** If the available dataset lacks temporal density, granularity, or reliable historical depth, descriptive risk prioritization, spatial clustering, or anomaly detection is officially preferred over a forced, fragile forecast.
- **Decision Support vs. Data Display:** The solution must not be a passive dashboard displaying charts. It must empower a real human decision-maker (e.g., city municipal officer, environmental regulator, transit manager, disaster response coordinator) to take a concrete, verifiable action based on transparent evidence.

---

## 2. Official 100-Point Scoring Rubric & Winning Strategy

Every feature, model, and interface decision must earn points directly from this rubric. Ties in shortlisting are resolved by: **Evaluation Integrity $\rightarrow$ Data Analysis $\rightarrow$ UI/UX**.

| Rubric Category | Weight | What Judges Look For | How CityPulse Secures Maximum Points | Traps & Penalties to Avoid |
| :--- | :---: | :--- | :--- | :--- |
| **1. Problem Framing & Relevance** | **10 pts** | Clearly defined urban issue, specific target user, realistic geographic/temporal scope, clear real-world decision supported. | Define explicit municipal/operational persona (e.g., Ward Officer / CPCB Monitoring Director); ground the exact decision being made, with quantifiable stakes. | Vague problem statement ("solving traffic in India"), no identified end-user, abstract or unmeasurable impact. |
| **2. Data Sourcing, Cleaning & EDA** | **20 pts** | Rigorous sourcing from legitimate public portals, thorough preprocessing, missing value handling, at least **3 actionable analytical findings**. | Fully documented Data Statement; clean scripts; outlier & missingness audit; 3 distinct, non-trivial, evidence-backed findings supported by maps/charts. | Decorative charts with no analytical takeaway, unaddressed missing data, synthetic data passed off as real, unverified joins. |
| **3. Method Selection & Analytical Quality** | **15 pts** | Justified choice of analytical method, implementation of a baseline model, avoidance of unnecessary complexity. | Clear baseline (e.g., historical rolling average, spatial heuristic) compared directly against candidate ML/statistical model; justified complexity trade-offs. | Jump to complex deep learning / LLMs without baseline comparison; "black-box" model where simpler regression/trees perform better. |
| **4. Evaluation, Validation & Integrity** | **15 pts** | Scientifically defensible validation, leak-free splits, appropriate metrics (MAE/RMSE, Precision/Recall, calibration), limitations reported. | Strict chronological / out-of-sample split; zero future-data leakage; calibration analysis; documented error bounds; honest edge-case failure analysis. | Random train/test split on time-series (data leakage); claiming 99% accuracy; hiding model failures; no ground-truth validation. |
| **5. UI/UX & Decision Usefulness** | **20 pts** | Interactive, aesthetic, intuitive interface designed for decision-making (Signal $\rightarrow$ Evidence $\rightarrow$ Action). | High-aesthetic modern UI (dark/light glassmorphism, responsive, micro-animations); workflow: Select Location/Time $\rightarrow$ View Risk Signal $\rightarrow$ Inspect Evidence $\rightarrow$ Recommend Concrete Action. | Generic dashboard displaying raw numbers with no guidance; cluttered charts; non-functional UI; poor typography and browser defaults. |
| **6. Explainability, Uncertainty & Limitations** | **10 pts** | Transparent feature contributions, explicit confidence intervals, acknowledged data biases and assumptions. | Transparent feature attribution (SHAP-inspired or transparent weight decomposition); confidence intervals / error margins; prominent data limitation banner. | Presenting predictions as absolute certainty; hidden assumptions; unexplainable outputs; claiming causal relationships from mere correlation. |
| **7. Implementation & Reproducibility** | **5 pts** | Zero-cost execution, no paid API keys, clear installation script/requirements, deterministic runs. | Single-command setup (`npm install` / `pip install`); public data cached locally or fetched via public unauthenticated API; zero proprietary dependencies. | Requiring OpenAI/Mapbox paid keys; missing `requirements.txt`; broken environment; code failing on a fresh clone. |
| **8. Presentation & Completeness** | **5 pts** | Polished 5-minute pitch, sharp slides, cohesive narrative, live demo, crisp 3-minute Q&A defense. | High-tempo presentation strictly following: Problem (0:30) $\rightarrow$ Data & Insights (0:45) $\rightarrow$ Method & Baseline (0:45) $\rightarrow$ Live Demo (2:30) $\rightarrow$ Limitations (0:30). | Running overtime; spending 4 minutes on slides and rushing demo; defensive or evasive answers during Q&A. |
| **TOTAL** | **100 pts** | — | **Balanced, robust, end-to-end execution across all 8 dimensions.** | — |

---

## 3. Strict Constraints & "Safe Direction" Guardrails

To prevent immediate disqualification or score deduction, the team must adhere strictly to these non-negotiable constraints:

### 3.1 Zero-Cost & Free-Tier Reproducibility Constraint
- **No Paid APIs or Models:** Absolutely no OpenAI, Claude, proprietary Mapbox, Google Maps Geocoding API, or other services requiring a paid billing account or credit card.
- **Judges Must Be Able to Run the Code:** A judge cloning the repo must be able to launch and evaluate the core demo without signing up for paid subscriptions or entering private secrets.
- **Maps & Geo Services:** Use Leaflet, MapLibre GL, or OpenStreetMap (OSM) with free tile providers (CartoDB Positron / OSM tiles / Stamen).
- **Compute:** Must run smoothly on standard consumer hardware (CPU or free local execution).

### 3.2 Data Integrity & Licensing
- **Public Datasets Only:** Sourced from authorized portals (data.gov.in, OpenAQ, CPCB, IMD, World Bank, OSM).
- **Documented Provenance:** Source URL, access date, schema, licensing terms, and preprocessing logic must be published in a `DATA_STATEMENT.md`.
- **Synthetic Data Rule:** Synthetic/mock data is strictly prohibited as real evidence. It may **only** be used for UI layout testing/edge cases and must be explicitly watermarked as `[TESTING FIXTURE]`.
- **No Private Credentials in Code:** Never commit `.env` files with secret tokens or personal API keys.

### 3.3 Scientific Honesty & Responsible AI
- **Correlation $\neq$ Causation:** Never claim that an observed weather association or demographic factor *causes* an urban event unless an experimental causal design exists. State findings as empirical correlations or observed risk patterns.
- **Prototype Disclaimer:** The interface must prominently display a disclaimer:  
  *`"Prototype for decision-support and research evaluation only. Not an official municipal or emergency alert system."`*
- **Explicit Uncertainty:** Every quantitative output must be accompanied by uncertainty bounds, sample counts, or confidence ratings.
- **Acknowledge Sampling Bias:** Explicitly document sensor distribution bias (e.g., CPCB air monitoring stations are clustered in specific urban centers or industrial corridors, leaving suburban pockets under-monitored).

---

## 4. The 4-Stage Core Workflow

```mermaid
flowchart LR
    A["1. DISCOVER\n(EDA & Spatial Patterns)"] --> B["2. PREDICT\n(Feasible Forecast or Risk Score)"]
    B --> C["3. EXPLAIN\n(Feature Weights & Uncertainty)"]
    C --> D["4. ACT\n(Concrete Operational Next Steps)"]
    
    style A fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    style B fill:#1e293b,stroke:#818cf8,stroke-width:2px,color:#f8fafc
    style C fill:#1e293b,stroke:#f59e0b,stroke-width:2px,color:#f8fafc
    style D fill:#1e293b,stroke:#10b981,stroke-width:2px,color:#f8fafc
```

### Stage 1: Discover (Exploratory Data Analysis)
- Ingest cleaned urban datasets.
- Compute spatial, diurnal, seasonal, and categorical distributions.
- Uncover at least **three distinct, non-trivial empirical findings**.

### Stage 2: Predict (Or Prioritize Risk)
- If temporal frequency supports it: Compute a baseline (e.g., 7-day rolling median / persistence model) and compare against a lightweight, interpretable predictive model (e.g., Ridge, Random Forest, XGBoost, or ARIMA/Prophet).
- If temporal frequency is sparse: Compute an objective, transparent **Composite Risk Index (CRI)** or Priority Score with clear mathematical formulas.

### Stage 3: Explain (Uncertainty & Attributions)
- Provide breakdown of the top contributing factors to the signal (e.g., "70% driven by stagnant wind speed < 1.5 m/s + drop in boundary layer height").
- Display error margins (e.g., $\pm 18\ \mu g/m^3$ at 90% confidence) or data reliability scores based on sensor uptime.

### Stage 4: Act (Operational Recommendations)
- Convert signals directly into actionable municipal protocols:
  - *Tier 1 (Moderate Risk):* Increase street mechanical sweeping frequency in Sector X.
  - *Tier 2 (High Risk):* Divert heavy diesel freight along Outer Ring Road during 06:00–10:00.
  - *Tier 3 (Critical Risk):* Issue targeted advisories to localized vulnerable facilities (schools, hospitals) within 1.5 km radius.

---

## 5. Candidate Urban Problem Domains & Evaluation Matrix

| Domain | Candidate Focus | Primary Public Data Sources | Feasibility & Validation Potential | Decision Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Option A: Air Quality & Environmental Risk** | Hyperlocal AQI & PM2.5 hotspot forecasting, winter inversion spikes, industrial vs. vehicular corridor risk. | OpenAQ API, CPCB portal (data.gov.in), IMD weather / ERA5 reanalysis open subsets. | **Very High:** Dense hourly/daily continuous data; easy chronological validation; transparent baseline. | High: Targeted smog-gun deployment, traffic rerouting, school advisory scheduling. |
| **Option B: Monsoon Flood & Disruption** | Waterlogging hotspot prioritization, urban drainage vulnerability, transit delay risk during intense rainfall. | IMD rainfall data, municipal drainage / open flood logs, OpenStreetMap elevation/topography & road networks. | **Medium:** Historical flood incident logs are often sparse, fragmented, or unstandardized across cities. | High during monsoon; less relevant year-round. |
| **Option C: Civic Infrastructure & Grievance Resolution** | Citizen grievance resolution delays, recurring pothole/water-leak hotspots, municipal resource allocation. | Municipal open data portals (e.g., data.gov.in, BMC, BBMP, or Delhi open portals if available). | **Medium-Low:** High missingness, varied taxonomy across wards, erratic reporting frequency. | High for ward councillors and municipal engineers. |

*(The final domain must be selected based on confirmed data availability, clean schema verification, and chronological depth).*

---

## 6. The 6 Mandatory Submission Deliverables

1. **Working Prototype:** Fully interactive, responsive, intuitive web application with zero console errors.
2. **Source Code Repository:** Clean git history, modular architecture, complete `README.md`, single-step installation instructions.
3. **Data Statement (`DATA_STATEMENT.md`):** Complete provenance: source URLs, licensing, dates accessed, data dictionary, missingness and outlier treatment.
4. **Analysis & Method Report / Notebook:** Reproducible Jupyter notebook or report containing raw data ingestion, EDA, 3+ findings, baseline comparison, and evaluation metrics.
5. **Presentation Slides (5-Minute Finalist Pitch):** Concise, visually striking slide deck following the competition narrative.
6. **Reproducibility Notes:** Step-by-step verification guide ensuring any judge can run the prototype locally without paid keys or specialized hardware.

---

## 7. The 5-Minute Finalist Presentation Structure

| Time Window | Segment | Critical Content to Deliver |
| :---: | :--- | :--- |
| **0:00 – 0:30** | **The Urban Problem & Persona** | Who is the user? What municipal budget/health decision is broken today? Why does it matter? |
| **0:30 – 1:15** | **Data Integrity & Top 3 Insights** | Where the data came from, how it was cleaned, and the 3 key analytical findings. |
| **1:15 – 2:00** | **Analytical Method & Validation** | The baseline used, the analytical/predictive model chosen, and rigorous out-of-sample metrics. |
| **2:00 – 4:30** | **Live Decision-Support Demo** | Real-time walkthrough: Pick ward/station $\rightarrow$ Observe risk signal $\rightarrow$ Inspect evidence/uncertainty $\rightarrow$ Generate action. |
| **4:30 – 5:00** | **Honest Limitations & Next Steps** | Data biases acknowledged, sensor density limitations, ethical safeguards, and future work. |
| **5:00 – 8:00** | **Technical Q&A Defense** | Confident, precise answers on leakage prevention, baseline choices, and data reproducibility. |

---

## 8. Anti-Patterns & Disqualification Traps

- ❌ **The "Model in Search of a Problem" Trap:** Building an ultra-complex transformer or LSTM when a standard gradient-boosted tree or seasonal autoregression outperforms it and trains in 2 seconds.
- ❌ **The "Decorative Dashboard" Trap:** Showing 15 unrelated KPI cards and line charts that do not lead to an actionable operational decision.
- ❌ **The Data Leakage Trap:** Using future data in training features (e.g., standard k-fold cross validation across time series).
- ❌ **The Paid API Trap:** Requiring an OpenAI API key or paid Google Maps key for the app to function.
- ❌ **The "Uncertainty Blindness" Trap:** Quoting exact single numbers (e.g., "AQI will be 243.2 at 4 PM") without confidence intervals or error distributions.
- ❌ **The Fabricated Result Trap:** Hardcoding favorable numbers or cherry-picking metrics.

---

## 9. Next Operational Steps
1. Ingest official 8-page PDF document to cross-examine any competition-specific amendments or prompts.
2. Confirm target domain through live data-feasibility audit.
3. Lock in Problem Statement Specification, Baseline, and Architecture.
4. Build in strict compliance with this Knowledge Base.
