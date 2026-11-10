import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './ui/app.tsx'
import { connected } from './data/client.ts'
import { initializeDemo } from './data/local.ts'
import './styles.css'

if (!connected) initializeDemo()
createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>)
