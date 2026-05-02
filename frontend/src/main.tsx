import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
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
        <Route path="/stations" element={<StationPicker />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
