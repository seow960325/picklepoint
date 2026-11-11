import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
// Fonts ship with the app (no Google Fonts request at the venue) in every weight the
// screens use: before, 800/900 headings were a browser-faked bold of the 700 file.
import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/barlow-condensed/900.css'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/cinzel/900.css'
import './index.css'
import Join from './pages/Join'
import Board from './pages/Board'
import CourtScore from './pages/CourtScore'
import MatchDetail from './pages/MatchDetail'
import NewCompetition from './pages/NewCompetition'
import Admin from './pages/Admin'
import Owner from './pages/Owner'
import QuickPlay from './pages/QuickPlay'
import CombinedTv from './pages/CombinedTv'
import Register from './pages/Register'
import Medals from './pages/Medals'
import Referee from './pages/Referee'
import { PreviewLayout } from './lib/previewStage'

const router = createBrowserRouter([{ element: <PreviewLayout />, children: [
  { path: '/', element: <Join /> },
  { path: '/quick', element: <QuickPlay /> },
  { path: '/register', element: <Register /> },
  { path: '/register/:code', element: <Register /> },
  { path: '/new', element: <NewCompetition /> },
  { path: '/c/:code', element: <Board /> },
  { path: '/c/:code/court/:number', element: <CourtScore /> },
  { path: '/c/:code/referee', element: <Referee /> },
  { path: '/c/:code/match/:id', element: <MatchDetail /> },
  { path: '/c/:code/admin', element: <Admin /> },
  { path: '/owner', element: <Owner /> },
  { path: '/tv/:codes', element: <CombinedTv /> },
  { path: '/medals/:codes', element: <Medals /> },
] }])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
