import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useApp, applyTheme } from './store'
import './styles/app.css'

// apply the persisted theme before first paint to avoid a flash
applyTheme(useApp.getState().theme)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
