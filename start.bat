@echo off
rem Starts all of SmartGate: PostgreSQL and Redis in Docker, the four
rem services, the API gateway and the frontend, each in its own window.
rem
rem To stop: close the six windows, then run "docker compose down"
rem (your data is kept).
rem First time on a new computer: copy .env.example to .env and run
rem "npm install" in gateway, frontend and each folder in services.

cd /d "%~dp0"
title SmartGate starter

rem 1. Docker Desktop must be running.
docker info >nul 2>&1 && goto docker_ready
echo Starting Docker Desktop...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
:wait_docker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1 || goto wait_docker
:docker_ready

rem 2. Database and Redis.
echo Starting PostgreSQL and Redis...
docker compose up -d
:wait_db
docker exec smartgate-postgres pg_isready >nul 2>&1 && goto db_ready
timeout /t 2 /nobreak >nul
goto wait_db
:db_ready
echo Database is ready.

rem 3. The frontend needs port 5173.
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul && (
  echo.
  echo WARNING: another program is already using port 5173.
  echo Close it, or the browser may open that program instead of SmartGate.
  echo.
)

rem 4. One window per part. The services start first, then the gateway
rem    that forwards to them, then the frontend.
echo Starting the services...
start "SmartGate Auth (4001)" /d services\auth-service cmd /k npm start
start "SmartGate Attendance (4002)" /d services\attendance-service cmd /k npm start
start "SmartGate Recognition (4003)" /d services\recognition-service cmd /k npm start
start "SmartGate Alerts (4004)" /d services\alerts-service cmd /k npm start
timeout /t 3 /nobreak >nul
start "SmartGate Gateway (4000)" /d gateway cmd /k npm start
start "SmartGate Frontend (5173)" /d frontend cmd /k npm start

rem 5. Open the browser once the frontend has been built.
echo Building the frontend, this takes a few seconds...
:wait_ui
timeout /t 2 /nobreak >nul
curl -s -o nul http://localhost:5173 || goto wait_ui
start http://localhost:5173
echo.
echo SmartGate is running at http://localhost:5173
echo You can close this window.
