import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { startTheme } from './data/theme'

startTheme()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
