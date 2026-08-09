import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { FehlerMelder } from "@/components/FehlerMelder"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <FehlerMelder>
          <App />
        </FehlerMelder>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
