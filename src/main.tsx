import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Join from './pages/Join'
import Board from './pages/Board'
import CourtScore from './pages/CourtScore'
import MatchDetail from './pages/MatchDetail'
import NewCompetition from './pages/NewCompetition'
import Admin from './pages/Admin'

const router = createBrowserRouter([
  { path: '/', element: <Join /> },
  { path: '/new', element: <NewCompetition /> },
  { path: '/c/:code', element: <Board /> },
  { path: '/c/:code/court/:number', element: <CourtScore /> },
  { path: '/c/:code/match/:id', element: <MatchDetail /> },
  { path: '/c/:code/admin', element: <Admin /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
