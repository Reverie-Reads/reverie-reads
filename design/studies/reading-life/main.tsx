import { createRoot } from 'react-dom/client'
import { SKIN_ORDER } from '@reverie/core'
import './study.css'
import { ReadingLifeStudy } from './ReadingLifeStudy'
const params = new URLSearchParams(location.search)
const candidate = params.get('skin')
document.documentElement.dataset.skin = SKIN_ORDER.find((s) => s === candidate) ?? 'folio'
document.documentElement.dataset.mode = params.get('mode') === 'dark' ? 'dark' : 'light'
createRoot(document.getElementById('root')!).render(<ReadingLifeStudy />)
