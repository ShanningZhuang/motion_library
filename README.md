# Motion Library Visualization

A web-based platform for managing and visualizing robot motion trajectories from research data.

## Project Structure

```
motion_library/
├── backend/          # FastAPI backend
│   ├── main.py      # Main application entry point
│   ├── auth.py      # Authentication logic
│   ├── storage.py   # File system storage manager
│   ├── models.py    # Pydantic models
│   ├── config.py    # Configuration settings
│   └── requirements.txt
├── frontend/         # Next.js frontend
│   ├── app/         # Next.js app directory
│   ├── lib/         # API client
│   └── contexts/    # React contexts
├── data/            # File system storage
│   ├── models/      # MuJoCo XML models
│   └── trajectories/ # NPY/NPZ trajectory files
└── idea.md          # Project specification
```

## Getting Started

### Prerequisites

- Python 3.8+
- Node.js 18+
- npm or yarn

### Backend Setup

#### Option 1: Using uv (Recommended)

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies with uv:
```bash
uv sync
```

3. Configure environment variables (optional):
```bash
# Edit backend/.env to change settings
# Default password is "admin123"
# Change SECRET_KEY in production!
```

4. Run the backend:
```bash
uv run python main.py
```

#### Option 2: Using pip

1. Navigate to the backend directory:
```bash
cd backend
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Configure environment variables (optional):
```bash
# Edit backend/.env to change settings
# Default password is "admin123"
# Change SECRET_KEY in production!
```

5. Run the backend:
```bash
python main.py
```

The backend API will run on `http://localhost:8000`

API documentation is available at `http://localhost:8000/docs`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:3000`

### First Login

1. Open `http://localhost:3000` in your browser
2. Enter the password (default: `admin123`)
3. You'll be redirected to the dashboard

### Uploading Data

**Models:**
- Click "Upload Model" in the Models section
- Select a MuJoCo XML file (.xml)
- The model will be stored in `data/models/`

**Trajectories:**
- Click "Upload Trajectory" in the Trajectories section
- Select a NPY or NPZ file containing:
  - `qpos`: Joint positions array (shape: [n_frames, n_joints])
  - `frame_rate`: Playback frame rate (optional for NPY files)
- The trajectory will be stored in `data/trajectories/`

## Features Implemented

### Backend (FastAPI)
- ✅ JWT-based authentication
- ✅ File system storage for models and trajectories
- ✅ RESTful API endpoints for CRUD operations
- ✅ NPY/NPZ file parsing and metadata extraction
- ✅ Category-based trajectory organization
- ✅ CORS support for frontend

### Frontend (Next.js)
- ✅ Login/authentication page
- ✅ Protected dashboard with trajectory and model management
- ✅ File upload functionality
- ✅ Trajectory browsing and filtering by category
- ✅ Visualization page structure with playback controls
- ⏳ MuJoCo WASM integration (next step)
- ⏳ Actual 3D trajectory playback (next step)

## Next Steps

### MuJoCo WASM Integration

To complete the visualization functionality, you'll need to:

1. **Install MuJoCo WASM package:**
```bash
cd frontend
npm install mujoco
```

2. **Implement NPY/NPZ parsing in the browser:**
   - Add a library like `ndarray` or `numpy.js` to parse binary files
   - Extract qpos and frame_rate data from uploaded trajectories

3. **Integrate MuJoCo viewer:**
   - Load MuJoCo WASM in the visualization page
   - Load the XML model
   - Apply qpos values from trajectory to the simulation
   - Implement frame-by-frame playback

4. **Add camera controls:**
   - Mouse orbit controls for 3D view
   - Zoom and pan functionality
   - Reset camera button

## SSL Certificate Renewal

The SSL certificate for the domain expires every 90 days. When the site shows a certificate error, renew it manually:

```bash
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

## Technology Stack

- **Backend**: FastAPI (Python)
- **Frontend**: Next.js 14, React 19, TailwindCSS 4
- **Visualization**: MuJoCo WASM (to be integrated)
- **Storage**: File system (NPY/NPZ files)
- **Authentication**: JWT-based password protection

## Configuration

### Backend (.env)

```env
# Authentication
SECRET_KEY=your-secret-key-here-change-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Admin credentials
ADMIN_PASSWORD=admin123

# Server
HOST=0.0.0.0
PORT=8000

# Paths
DATA_DIR=../data
MODELS_DIR=../data/models
TRAJECTORIES_DIR=../data/trajectories
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with password
- `POST /api/auth/verify` - Verify JWT token

### Trajectories
- `GET /api/trajectories` - List all trajectories
- `GET /api/trajectories/{id}` - Download trajectory file
- `POST /api/trajectories` - Upload new trajectory
- `DELETE /api/trajectories/{id}` - Delete trajectory

### Models
- `GET /api/models` - List all models
- `GET /api/models/{id}` - Download model file
- `POST /api/models` - Upload new model
- `DELETE /api/models/{id}` - Delete model

## Development

### Running in Development

**Terminal 1 (Backend with uv):**
```bash
cd backend
uv run uvicorn main:app --reload
```

**Or with pip:**
```bash
cd backend
source venv/bin/activate  # On Windows: venv\Scripts\activate
python main.py
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm run dev
```

### Project Status

See [idea.md](idea.md) for full project specification and planned features.

Current status: **Core functionality complete** - Ready for MuJoCo WASM integration.
