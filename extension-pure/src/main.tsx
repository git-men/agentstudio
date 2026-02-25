import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/styles/mobile.css'
import App from './App'
import i18n from '@/i18n'
import '@/i18n/types'

if (!localStorage.getItem('i18nextLng')) {
  i18n.changeLanguage('zh-CN');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
