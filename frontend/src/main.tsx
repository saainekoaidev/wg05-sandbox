import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { Account } from './pages/Account'
import { AdminLineEdit, AdminLineNew } from './pages/AdminLineForm'
import { AdminLines } from './pages/AdminLines'
import { AdminStationEdit, AdminStationNew } from './pages/AdminStationForm'
import { AdminStations } from './pages/AdminStations'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { RouteDetail } from './pages/RouteDetail'
import { RouteEdit } from './pages/RouteEdit'
import { RouteList } from './pages/RouteList'
import { RouteRegister } from './pages/RouteRegister'
import { StationPicker } from './pages/StationPicker'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/routes" element={<RouteList />} />
        <Route path="/routes/new" element={<RouteRegister />} />
        <Route path="/routes/:id" element={<RouteDetail />} />
        <Route path="/routes/:id/edit" element={<RouteEdit />} />
        <Route path="/stations" element={<StationPicker />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin/lines" element={<AdminLines />} />
        <Route path="/admin/lines/new" element={<AdminLineNew />} />
        <Route path="/admin/lines/:id/edit" element={<AdminLineEdit />} />
        <Route path="/admin/stations" element={<AdminStations />} />
        <Route path="/admin/stations/new" element={<AdminStationNew />} />
        <Route path="/admin/stations/:id/edit" element={<AdminStationEdit />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
