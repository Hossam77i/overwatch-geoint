<div align="center">
  <img src="https://img.icons8.com/color/144/000000/radar.png" alt="Overwatch Radar" width="100"/>
  <h1>Overwatch GEOINT</h1>
  <p><strong>Serverless Geospatial Intelligence & Open Source Intelligence (OSINT) Platform</strong></p>

  <p>
    <a href="https://github.com/Hossam77i/overwatch-geoint/actions/workflows/deploy.yml">
      <img src="https://github.com/Hossam77i/overwatch-geoint/actions/workflows/deploy.yml/badge.svg" alt="CI/CD Pipeline"/>
    </a>
    <a href="https://www.python.org/downloads/release/python-3110/">
      <img src="https://img.shields.io/badge/Python-3.11-blue.svg" alt="Python 3.11"/>
    </a>
    <a href="https://aws.amazon.com/lambda/">
      <img src="https://img.shields.io/badge/AWS-Serverless-orange.svg" alt="AWS Serverless"/>
    </a>
    <a href="https://www.terraform.io/">
      <img src="https://img.shields.io/badge/Terraform-1.5.0-purple.svg" alt="Terraform"/>
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License"/>
    </a>
  </p>
  
  <p>
    <a href="#architecture">Architecture</a> 
    <a href="#features">Features</a> 
    <a href="#quick-start">Quick Start</a> 
    <a href="#devsecops-workflow">DevSecOps</a> 
    <a href="#contributing">Contributing</a>
  </p>
</div>

---


## 🚨 LATEST UPDATE (v2.0) - GOD'S EYE 3D MODE
The dashboard now features a massive upgrade: **God's Eye 3D Cinematic Mode**.
Clicking the `🌐 3D MODE` button instantly morphs the interface into a tactical circular lens viewport tracking a photorealistic 3D globe powered by Cesium and OpenStreetMap.

**New 3D Features:**
- **✈️ Cinematic Cockpit Chase Camera**: The engine dynamically hooks into live global ADSB aviation data. Click `COCKPIT` to automatically lock onto a random aircraft in your sector and zoom into a 3D chase-camera view tracking it in real-time.
- **🚀 Live Seismic Threat Tracking**: Click `SPACE MISSIONS` to fetch the live USGS Earthquake feed and plot M2.5+ seismic anomalies as glowing red spheres directly onto the 3D globe.
- **◎ Dynamic Macro OSINT**: The `CONTACTS` and `DATA LAYERS` buttons interface directly with the AWS Serverless Proxy, utilizing the 3D viewport's exact coordinates to scan the Overpass API for Military, Energy, and Aviation infrastructure, rendering them as vertical tactical red laser beams piercing the sky.

## Overview

**Overwatch GEOINT** is a highly scalable, event-driven tactical intelligence dashboard. It is capable of parsing global geospatial data in real-time, executing Computer Vision (CV) tracking models against satellite imagery, and maintaining extreme low-latency tracking of global infrastructure without relying on expensive, always-on servers.

Built strictly on **Serverless AWS** principles, it bridges the gap between heavy computer vision workloads and ephemeral serverless compute functions.

##  Architecture

The system utilizes an advanced event-driven architecture defined via Terraform Infrastructure-as-Code (IaC).

```mermaid
graph TD
    subgraph Frontend
        UI[Leaflet.js 2D] -->|Event Bus| V3D[CesiumJS 3D Globe]
    end
    UI -->|HTTP POST| API[AWS API Gateway]
    API --> Lambda[AWS Lambda<br/>Python + OpenCV]
    
    Lambda -->|Target Caching| DDB[(DynamoDB<br/>Infra Cache & TTL)]
    Lambda -->|Imagery Storage| S3[(Amazon S3)]
    
    Lambda -->|Proxy/Query| ADS[ADS-B Airspace Data]
    Lambda -->|Proxy/Query| OSM[OpenStreetMap Overpass]
    Lambda -->|Satellite Feed| ArcGIS[ArcGIS Imagery API]
```

##  Features

- **Computer Vision Macros:** Automated OpenCV morphological detection for Maritime, Aviation, and Ground Armor signatures utilizing non-maximum suppression (NMS) algorithms.
- **Real-Time Airspace Tracking:** Live ADS-B transponder data streams intercept and track global aviation assets in real-time.
- **100% Serverless:** Pay-per-use architecture running on AWS Lambda, scaling instantly from 0 to 1,000+ concurrent scans.
- **Threat Intelligence Logging:** Rolling 48-hour incident response tracker using DynamoDB Time-To-Live (TTL) and secure GeoIP HTTPS resolution.
- **Tactical UI:** High-performance, Canvas-accelerated Leaflet.js dashboard built for complex geographical rendering without DOM lagging.

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [AWS CLI](https://aws.amazon.com/cli/)
- [Terraform](https://www.terraform.io/downloads.html) >= 1.5.0
- Python 3.11+

### Local Setup
```bash
# 1. Clone the repository
git clone https://github.com/Hossam77i/overwatch-geoint.git
cd overwatch-geoint

# 2. Configure Python Virtual Environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. Run the Core Test Suite
pytest tests/
```

### Infrastructure Deployment
```bash
cd terraform
terraform init
terraform plan
terraform apply -auto-approve
```

## DevSecOps Workflow

This repository strictly enforces professional DevSecOps standards via GitHub Actions:
- **Trivy:** Static container vulnerability scanning against the Lambda ECR image.
- **Bandit:** SAST (Static Application Security Testing) to prevent secrets leakage.
- **Flake8 & Black:** Strict PEP-8 code style enforcement and complexity bounds.
- **Pytest:** Mapped and mocked integration testing for CV logic.
- **Terraform:** Infrastructure configuration and permission boundaries dynamically deployed via CI/CD.

## Contributing

We welcome contributions from the Open Source Intelligence (OSINT) and DevSecOps community! Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting Pull Requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Recent Architectural Upgrades
- **Modular Uncoupling**: Transitioned from a monolithic handler to distinct, testable domain modules (`src/api`, `src/cv`, `src/osint`, `src/db`).
- **3D God's Eye View**: Integrated a lazy-loaded CesiumJS layer that shares state with Leaflet via an event bus, bringing a 3D orbital capability without duplicating fetches or logic.
- **Event-Driven UI**: Converted direct DOM manipulation of tactical components to a standardized event-dispatch model (`geoint:radar_update`, `geoint:osint_update`).
