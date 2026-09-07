import React from 'react'
import ReactDOM from 'react-dom/client'
import { MobileApp } from './MobileApp'
import { installMobileBridge } from './bridge'
import { startMobileShell } from './shell'
import '../renderer/src/styles/theme.css'
import '../renderer/src/styles/app.css'
import './mobile.css'

// The bridge must exist before any component asks the platform a question.
installMobileBridge()
startMobileShell()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
)
