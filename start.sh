#!/usr/bin/env bash
# ============================================================
# QLD AI Tutor — One-Click Start
# ============================================================
# Usage: ./start.sh [--prod|--dev]
# Production is the safe default; use --dev explicitly for reload/HMR.
# This starts both the backend and frontend in one terminal.
# Press Ctrl+C to stop both.
# ============================================================

set -e

cd "$(dirname "$0")"

echo "🎓 Starting QLD AI Tutor..."
echo ""

# Check prerequisites
if [ ! -d "backend/venv" ]; then
    echo "❌ Backend venv not found. Run setup first:"
    echo "   python3 -m venv backend/venv"
    echo '   backend/venv/bin/pip install -e ".[dev,test]"'
    exit 1
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "❌ Frontend dependencies not found. Run setup first:"
    echo "   cd frontend && npm install"
    exit 1
fi

# Ensure frontend has access to the root .env file
if [ ! -f "frontend/.env" ]; then
    echo "🔗 Creating symlink for frontend environment variables..."
    cd frontend
    ln -sf ../.env .env
    cd ..
fi

# Parse options. Production is the default so an omitted flag never enables
# file watchers, hot reload, or the Turbopack development server.
MODE="prod"
case "${1:-}" in
    ""|--prod)
        ;;
    --dev)
        MODE="dev"
        ;;
    *)
        echo "Usage: ./start.sh [--prod|--dev]" >&2
        exit 2
        ;;
esac

if [ "$MODE" == "prod" ]; then
    # Production Mode (Default)
    if [ ! -d "frontend/.next/server" ]; then
        echo "📦 Production build not found. Building frontend..."
        cd frontend
        npm run build
        cd ..
    fi
    echo "🔧 Starting backend (production) on http://localhost:8000 ..."
    backend/venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8000 &
    BACKEND_PID=$!

    sleep 2

    echo "🌐 Starting frontend (production) on http://localhost:3000 ..."
    cd frontend
    npm run start -- -p 3000 &
    FRONTEND_PID=$!
    cd ..
else
    # Development Mode (Explicit --dev only)
    echo "🔧 Starting backend (development with reload) on http://localhost:8000 ..."
    backend/venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend --reload-dir core &
    BACKEND_PID=$!

    sleep 2

    echo "🌐 Starting frontend (development with Turbopack) on http://localhost:3000 ..."
    cd frontend
    npm run dev &
    FRONTEND_PID=$!
    cd ..
fi

echo ""
echo "✅ System is running in ${MODE} mode!"
echo ""
echo "   📖 Open in browser: http://localhost:3000"
echo "   📊 Parent dashboard: http://localhost:3000/parent"
echo "   📝 Mock exam:        http://localhost:3000/exam"
echo ""
echo "   Press Ctrl+C to stop."
echo ""

# Trap Ctrl+C to kill both processes
trap 'echo ""; echo "Stopping..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0' INT TERM

# Wait for either process to exit
wait
